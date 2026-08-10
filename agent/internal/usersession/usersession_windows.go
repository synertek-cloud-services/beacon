//go:build windows

// Package usersession launches a process in the context of the currently
// active console user, from the agent's own SYSTEM-context service process.
// This does not expand what Beacon can already do -- every command Beacon
// dispatches today (run_script in particular) already runs as SYSTEM, which
// is strictly more powerful than any logged-in user's own context. This
// primitive is reachable through the exact same technician-authenticated
// command dispatch as everything else; it only changes *whose* context a
// launch happens in, not what's authorized to run.
//
// v1 deliberately targets only the active console session, not every
// RDP/fast-user-switched session on a terminal server -- the simplest and
// safest default. "No one is logged in" (locked screen, no active session,
// a server with nobody logged in) is treated as an expected, common no-op
// via ErrNoActiveSession, never as a failure -- this must never surface as
// an error in the agent's normal check-in loop.
package usersession

import (
	"errors"
	"fmt"
	"log"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ErrNoActiveSession means there's currently no active console session (no
// one logged in, or a locked screen with no interactive session attached).
// Callers should treat this as "nothing to do," not an error condition.
var ErrNoActiveSession = errors.New("usersession: no active console session")

// ErrElevationNotAvailable means the target user's token has no linked
// (elevated) token to launch with -- either the account isn't a member of
// Administrators, or UAC is disabled entirely (no split-token behavior in
// either case). Expected and common, same non-fatal treatment as
// ErrNoActiveSession -- callers must not log this as a crash. This is
// Beacon's equivalent of the Windows UAC *consent* (Yes/No) prompt, which
// only a split-token administrator ever sees -- RunAsSessionWithCredentials
// below is the equivalent of the *credential* prompt a standard user sees
// instead, for when this sentinel is what comes back.
var ErrElevationNotAvailable = errors.New("usersession: elevation not available for this user (not an administrator, or UAC is disabled)")

// ErrInvalidCredentials means the admin username/password supplied to
// RunAsSessionWithCredentials were rejected by LogonUserW -- wrong
// password, unknown account, disabled/locked account, etc. Expected and
// common (a stale or misconfigured credential), same non-fatal treatment
// as the two sentinels above -- never a crash.
var ErrInvalidCredentials = errors.New("usersession: admin credentials rejected")

// golang.org/x/sys/windows wraps neither LogonUserW nor the seclogon-free
// credential-elevation path this file needs (confirmed by direct
// inspection of the pinned v0.23.0 source, the same check already made
// before building agent/internal/win32 for GDI/SendInput) -- so this is
// the second place this codebase calls a raw Win32 API outside that
// package's typed wrappers, via the same NewLazySystemDLL/NewProc pattern.
var (
	modadvapi32    = windows.NewLazySystemDLL("advapi32.dll")
	procLogonUserW = modadvapi32.NewProc("LogonUserW")
)

const (
	logon32LogonInteractive = 2
	logon32ProviderDefault  = 0
)

// RunAsActiveUser launches exe (with args) in the context of whoever is
// logged into the active *console* session specifically. Kept as a thin
// wrapper around RunAsSession for agent/tools/usersessiontest and anything
// else that genuinely only cares about the console -- most real callers
// (the tray supervisor) want RunAsSession across every active session
// instead, since console-only misses RDS/AVD/Windows 365 entirely (see
// ActiveSessions' doc comment).
func RunAsActiveUser(exe string, args []string) (pid uint32, err error) {
	sessionID := windows.WTSGetActiveConsoleSessionId()
	if sessionID == 0xFFFFFFFF {
		log.Printf("usersession: no active console session")
		return 0, ErrNoActiveSession
	}
	return RunAsSession(sessionID, exe, args)
}

// RunAsActiveUserElevated is RunAsActiveUser's elevated counterpart -- see
// RunAsSessionElevated. Kept console-only, matching RunAsActiveUser and
// Web Remote's own existing v1 scoping (no RDS/AVD multi-session
// elevation) -- there's no reason for the elevated path to diverge from
// that.
func RunAsActiveUserElevated(exe string, args []string) (pid uint32, err error) {
	sessionID := windows.WTSGetActiveConsoleSessionId()
	if sessionID == 0xFFFFFFFF {
		log.Printf("usersession: no active console session")
		return 0, ErrNoActiveSession
	}
	return RunAsSessionElevated(sessionID, exe, args)
}

// RunAsSession launches exe (with args) in the context of whoever is logged
// into the given session ID, using that user's own primary token and
// environment block -- not the SYSTEM service's own context. On success it
// returns the launched process's PID, so callers that need to track
// liveness later (see agent/internal/service's tray supervision logic)
// don't need to re-derive it themselves.
func RunAsSession(sessionID uint32, exe string, args []string) (pid uint32, err error) {
	return runAsToken(sessionID, exe, args, false)
}

// RunAsSessionElevated is RunAsSession's elevated counterpart -- launches
// into the same user's session, but using their *linked* (full/elevated)
// token instead of their standard one, so the launched process can
// interact with (not just see) UAC-elevated windows, which Windows'
// User Interface Privilege Isolation otherwise blocks a Medium-integrity
// process (everything RunAsSession launches) from doing. Confirmed on real
// hardware to be a real, distinct limitation: a technician could see an
// elevated window via Web Remote's screen capture (GDI capture isn't
// integrity-gated) but had no input control over it until it closed.
//
// Returns ErrElevationNotAvailable when the target user's token has no
// linked token to use -- not an administrator, or UAC disabled -- an
// expected, common outcome, never a crash.
func RunAsSessionElevated(sessionID uint32, exe string, args []string) (pid uint32, err error) {
	return runAsToken(sessionID, exe, args, true)
}

// runAsToken is the shared implementation behind RunAsSession and
// RunAsSessionElevated -- both differ only in which token (the queried
// user token itself, or its linked/elevated counterpart) gets duplicated
// into a primary token and handed to CreateProcessAsUser.
func runAsToken(sessionID uint32, exe string, args []string, elevated bool) (pid uint32, err error) {
	var userToken windows.Token
	if err := windows.WTSQueryUserToken(sessionID, &userToken); err != nil {
		if errors.Is(err, windows.ERROR_PRIVILEGE_NOT_HELD) {
			// A real, distinct failure -- the caller doesn't hold
			// SE_TCB_NAME ("Act as part of the operating system"), which
			// only SYSTEM has by default. Caught via real-hardware testing:
			// running the verification tool directly as an Administrator
			// (not via a SYSTEM-context scheduled task) hits exactly this,
			// and the original code below was swallowing it as a silent
			// no-op -- which would have hidden a genuine misconfiguration
			// if the real agent service ever lost this privilege. Must
			// never be conflated with "no one is logged in."
			return 0, fmt.Errorf("usersession: caller lacks SE_TCB_NAME privilege (must run as SYSTEM): %w", err)
		}
		// A console session ID with no queryable user token can happen
		// right at the login/lock-screen transition -- treat the same as
		// "no session" rather than a hard error, but only for this
		// catch-all case, now that the known, always-deterministic
		// privilege failure above is handled distinctly.
		log.Printf("usersession: session %d has no queryable user token: %v", sessionID, err)
		return 0, ErrNoActiveSession
	}
	defer userToken.Close()

	launchToken := userToken
	if elevated {
		linkedToken, err := userToken.GetLinkedToken()
		if err != nil {
			return 0, fmt.Errorf("%w: %v", ErrElevationNotAvailable, err)
		}
		defer linkedToken.Close()
		launchToken = linkedToken
	}

	return launchWithToken(launchToken, exe, args, sessionID)
}

// RunAsActiveUserWithCredentials is RunAsActiveUser's credential-based
// counterpart -- see RunAsSessionWithCredentials. Kept console-only,
// matching RunAsActiveUser/RunAsActiveUserElevated and Web Remote's own
// existing v1 scoping.
func RunAsActiveUserWithCredentials(exe string, args []string, username, password string) (pid uint32, err error) {
	sessionID := windows.WTSGetActiveConsoleSessionId()
	if sessionID == 0xFFFFFFFF {
		log.Printf("usersession: no active console session")
		return 0, ErrNoActiveSession
	}
	return RunAsSessionWithCredentials(sessionID, exe, args, username, password)
}

// RunAsSessionWithCredentials launches exe (with args) inside sessionID's
// desktop under an explicitly-supplied administrator account, rather than
// whoever is actually logged into that session -- Beacon's equivalent of
// the Windows UAC *credential* prompt (enter an admin's username+password),
// for the realistic common case where the logged-in user is a standard,
// non-admin account and RunAsSessionElevated's GetLinkedToken path has no
// linked token to use at all (ErrElevationNotAvailable). A split-token
// admin instead sees a *consent* (Yes/No) prompt -- RunAsSessionElevated
// already covers that case, and callers should try it first.
//
// username may be a bare local account name (treated as `.\username`,
// i.e. this machine) or `DOMAIN\username` -- LogonUserW's own documented
// format, so no separate domain parameter is exposed here.
//
// Deliberately does NOT use CreateProcessWithLogonW, the API "Run as
// different user" itself calls under the hood -- that API is designed to
// be invoked from an already-interactive process running inside the
// target session (e.g. explorer.exe), and has real, documented
// desktop-attachment failure modes when called from a Session-0 service
// like this one. Instead this reuses launchWithToken, the exact
// DuplicateTokenEx/CreateEnvironmentBlock/CreateProcessAsUser sequence
// already proven on real hardware by RunAsSession/RunAsSessionElevated
// above, with one necessary addition: a token WTSQueryUserToken returns is
// already tied to its session, but a token LogonUserW returns is not --
// its TokenSessionId is explicitly overwritten to sessionID via
// SetTokenInformation before duplication. See enableTcbPrivilege's doc
// comment for why that call needs SE_TCB_NAME explicitly enabled first,
// separately from whatever implicit privilege check WTSQueryUserToken
// performs internally elsewhere in this file.
//
// GENUINELY FRAGILE, not yet verified on real hardware -- same category as
// this codebase's other hand-derived Windows internals (the SES SigV4
// signer, the SendInput INPUT struct layout). If credential-based
// elevation doesn't work in practice, the TokenSessionId override below is
// the first thing to re-examine.
func RunAsSessionWithCredentials(sessionID uint32, exe string, args []string, username, password string) (pid uint32, err error) {
	domain, user := splitDomainUsername(username)
	token, err := logonUser(user, domain, password)
	if err != nil {
		return 0, fmt.Errorf("%w: %v", ErrInvalidCredentials, err)
	}
	defer token.Close()

	if err := enableTcbPrivilege(); err != nil {
		return 0, fmt.Errorf("usersession: enable SE_TCB_NAME: %w", err)
	}

	sid := sessionID
	if err := windows.SetTokenInformation(
		token,
		windows.TokenSessionId,
		(*byte)(unsafe.Pointer(&sid)),
		uint32(unsafe.Sizeof(sid)),
	); err != nil {
		return 0, fmt.Errorf("usersession: set token session: %w", err)
	}

	return launchWithToken(token, exe, args, sessionID)
}

// splitDomainUsername parses LogonUserW's documented `DOMAIN\username`
// convention, defaulting to "." (this machine) for a bare local account
// name -- keeps CV_LOCAL_ADMIN_USERNAME a single Company Variable rather
// than needing a second CV_ key just for domain, matching this codebase's
// "no more config than needed" convention (e.g. Credentialed Network
// Discovery's own fixed CV_SNMP_COMMUNITY/CV_SSH_* keys).
func splitDomainUsername(raw string) (domain, username string) {
	if idx := strings.IndexByte(raw, '\\'); idx >= 0 {
		return raw[:idx], raw[idx+1:]
	}
	return ".", raw
}

// logonUser wraps the raw LogonUserW Win32 call with LOGON32_LOGON_INTERACTIVE
// (a real interactive-equivalent logon, so the resulting token behaves like
// a normal console logon -- including profile-loading eligibility --
// rather than a lesser network-logon token) and LOGON32_PROVIDER_DEFAULT.
func logonUser(username, domain, password string) (windows.Token, error) {
	u, err := windows.UTF16PtrFromString(username)
	if err != nil {
		return 0, fmt.Errorf("encode username: %w", err)
	}
	d, err := windows.UTF16PtrFromString(domain)
	if err != nil {
		return 0, fmt.Errorf("encode domain: %w", err)
	}
	p, err := windows.UTF16PtrFromString(password)
	if err != nil {
		return 0, fmt.Errorf("encode password: %w", err)
	}
	var token windows.Token
	r1, _, callErr := procLogonUserW.Call(
		uintptr(unsafe.Pointer(u)),
		uintptr(unsafe.Pointer(d)),
		uintptr(unsafe.Pointer(p)),
		uintptr(logon32LogonInteractive),
		uintptr(logon32ProviderDefault),
		uintptr(unsafe.Pointer(&token)),
	)
	if r1 == 0 {
		return 0, fmt.Errorf("LogonUserW: %w", callErr)
	}
	return token, nil
}

// seTcbPrivilegeName is SE_TCB_NAME, "Act as part of the operating
// system" -- golang.org/x/sys/windows defines the TokenSessionId info
// class and SetTokenInformation itself but, like every other named
// privilege constant, not this string; Windows privilege names are always
// looked up by name via LookupPrivilegeValue, there is no numeric
// alternative.
const seTcbPrivilegeName = "SeTcbPrivilege"

// enableTcbPrivilege enables SE_TCB_NAME on the calling process's own
// token. The agent's SYSTEM account holds this privilege, but Windows
// doesn't enable every held privilege by default even for SYSTEM --
// SetTokenInformation's TokenSessionId check is against the *enabled*
// privilege list of the calling process's own token, a distinct
// requirement from whatever internal, separately-privileged check
// WTSQueryUserToken performs elsewhere in this file (which needs no
// explicit AdjustTokenPrivileges call to succeed).
func enableTcbPrivilege() error {
	self, err := windows.GetCurrentProcess()
	if err != nil {
		return fmt.Errorf("get current process: %w", err)
	}
	var procToken windows.Token
	if err := windows.OpenProcessToken(self, windows.TOKEN_ADJUST_PRIVILEGES|windows.TOKEN_QUERY, &procToken); err != nil {
		return fmt.Errorf("open process token: %w", err)
	}
	defer procToken.Close()

	namePtr, err := windows.UTF16PtrFromString(seTcbPrivilegeName)
	if err != nil {
		return fmt.Errorf("encode privilege name: %w", err)
	}
	var luid windows.LUID
	if err := windows.LookupPrivilegeValue(nil, namePtr, &luid); err != nil {
		return fmt.Errorf("lookup privilege value: %w", err)
	}

	tp := windows.Tokenprivileges{
		PrivilegeCount: 1,
		Privileges: [1]windows.LUIDAndAttributes{
			{Luid: luid, Attributes: windows.SE_PRIVILEGE_ENABLED},
		},
	}
	if err := windows.AdjustTokenPrivileges(procToken, false, &tp, 0, nil, nil); err != nil {
		return fmt.Errorf("adjust token privileges: %w", err)
	}
	return nil
}

// launchWithToken is the shared tail end of runAsToken and
// RunAsSessionWithCredentials: duplicate the given token into a primary
// token, build its environment block, and CreateProcessAsUser onto
// sessionID's desktop. token is expected to already be scoped to
// sessionID -- WTSQueryUserToken's result always is;
// RunAsSessionWithCredentials forces this via SetTokenInformation before
// calling in here. This is byte-for-byte the same sequence
// RunAsSession/RunAsSessionElevated already used before this function was
// extracted out of runAsToken -- their own real-hardware verification
// still covers it.
func launchWithToken(launchToken windows.Token, exe string, args []string, sessionID uint32) (pid uint32, err error) {
	// CreateProcessAsUser specifically requires a primary token, not just an
	// impersonation-level token -- the most common mistake in a hand-rolled
	// version of this pattern. Duplicated even for an already-elevated
	// linked token, not just a standard one -- defensive, matching this
	// function's own existing caution, rather than assuming a token's exact
	// type from documentation alone with no real Windows hardware here to
	// verify against.
	var primaryToken windows.Token
	if err := windows.DuplicateTokenEx(
		launchToken,
		windows.TOKEN_ALL_ACCESS,
		nil,
		windows.SecurityImpersonation,
		windows.TokenPrimary,
		&primaryToken,
	); err != nil {
		return 0, fmt.Errorf("usersession: duplicate token: %w", err)
	}
	defer primaryToken.Close()

	var envBlock *uint16
	if err := windows.CreateEnvironmentBlock(&envBlock, primaryToken, false); err != nil {
		return 0, fmt.Errorf("usersession: create environment block: %w", err)
	}
	defer windows.DestroyEnvironmentBlock(envBlock)

	cmdLine, err := commandLine(exe, args)
	if err != nil {
		return 0, fmt.Errorf("usersession: %w", err)
	}
	cmdLinePtr, err := windows.UTF16PtrFromString(cmdLine)
	if err != nil {
		return 0, fmt.Errorf("usersession: encode command line: %w", err)
	}
	desktop, err := windows.UTF16PtrFromString(`winsta0\default`)
	if err != nil {
		return 0, fmt.Errorf("usersession: encode desktop: %w", err)
	}

	si := windows.StartupInfo{Desktop: desktop}
	si.Cb = uint32(unsafe.Sizeof(si))
	var pi windows.ProcessInformation

	err = windows.CreateProcessAsUser(
		primaryToken,
		nil, // appName -- baked into cmdLine instead, so args quote consistently
		cmdLinePtr,
		nil, nil, // process/thread security attributes
		false, // inheritHandles
		// CREATE_NEW_CONSOLE deliberately omitted -- the only real consumer
		// today (beacon-tray.exe) is a pure GUI/systray app with no console
		// I/O at all, and that flag pops up a visible, empty, useless
		// console window alongside it. Caught via real-hardware testing on
		// a real VPS console (the tray icon itself worked correctly; this
		// stray window was the only actual defect). If a future consumer
		// genuinely needs a console (e.g. a script-execution use case),
		// that's a reason to make this configurable then, not to default
		// to it now for the one consumer that doesn't want it.
		windows.CREATE_UNICODE_ENVIRONMENT,
		envBlock,
		nil, // currentDir -- inherit
		&si,
		&pi,
	)
	if err != nil {
		return 0, fmt.Errorf("usersession: create process as user: %w", err)
	}
	defer windows.CloseHandle(pi.Process)
	defer windows.CloseHandle(pi.Thread)

	log.Printf("usersession: launched pid %d in session %d", pi.ProcessId, sessionID)
	return pi.ProcessId, nil
}

// ActiveSessions returns the session IDs of every currently-active
// interactive session on this machine -- not just the console session.
// This is the primitive that makes RDS (many concurrent users, console
// typically unused) and AVD/Windows 365 (no console session at all, ever --
// the single user's one session is itself delivered over the RDP protocol)
// actually work: console-only session targeting misses all of them, not
// just "extra" RDP sessions on top of a workstation's console one.
func ActiveSessions() ([]uint32, error) {
	var sessionsPtr *windows.WTS_SESSION_INFO
	var count uint32
	// handle 0 is WTS_CURRENT_SERVER_HANDLE, the documented Win32 sentinel
	// for "the local RD Session Host server" -- no separate WTSOpenServer
	// call needed for the local machine.
	if err := windows.WTSEnumerateSessions(0, 0, 1, &sessionsPtr, &count); err != nil {
		return nil, fmt.Errorf("usersession: enumerate sessions: %w", err)
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(sessionsPtr)))

	sessions := unsafe.Slice(sessionsPtr, count)
	var active []uint32
	for _, s := range sessions {
		if s.State == windows.WTSActive {
			active = append(active, s.SessionID)
		}
	}
	return active, nil
}

// commandLine builds a properly quoted Windows command line from exe+args --
// CreateProcessAsUser takes one command-line string, not an argv array.
func commandLine(exe string, args []string) (string, error) {
	if exe == "" {
		return "", errors.New("exe is required")
	}
	all := append([]string{exe}, args...)
	return windows.EscapeArg(all[0]) + joinEscaped(all[1:]), nil
}

func joinEscaped(args []string) string {
	s := ""
	for _, a := range args {
		s += " " + windows.EscapeArg(a)
	}
	return s
}
