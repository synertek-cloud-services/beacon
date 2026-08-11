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
	"unsafe"

	"golang.org/x/sys/windows"
)

// ErrNoActiveSession means there's currently no active console session (no
// one logged in, or a locked screen with no interactive session attached).
// Callers should treat this as "nothing to do," not an error condition.
var ErrNoActiveSession = errors.New("usersession: no active console session")

// ActiveConsoleSessionID returns the Windows Terminal Services session ID
// of whoever is logged into the active console session, or
// ErrNoActiveSession if nobody is. Exported (unlike a bare
// WTSGetActiveConsoleSessionId call) so cross-platform callers outside
// this package -- e.g. session/screenshare.go, which has no
// _windows.go/_other.go split of its own -- can resolve "the console" for
// RunAsSessionAsSystem without needing a Windows-only file just for that.
func ActiveConsoleSessionID() (uint32, error) {
	sessionID := windows.WTSGetActiveConsoleSessionId()
	if sessionID == 0xFFFFFFFF {
		return 0, ErrNoActiveSession
	}
	return sessionID, nil
}

// RunAsActiveUser launches exe (with args) in the context of whoever is
// logged into the active *console* session specifically. Kept as a thin
// wrapper around RunAsSession for agent/tools/usersessiontest and anything
// else that genuinely only cares about the console -- most real callers
// (the tray supervisor) want RunAsSession across every active session
// instead, since console-only misses RDS/AVD/Windows 365 entirely (see
// ActiveSessions' doc comment).
func RunAsActiveUser(exe string, args []string) (pid uint32, err error) {
	sessionID, err := ActiveConsoleSessionID()
	if err != nil {
		log.Printf("usersession: no active console session")
		return 0, err
	}
	return RunAsSession(sessionID, exe, args)
}

// RunAsSession launches exe (with args) in the context of whoever is logged
// into the given session ID, using that user's own primary token and
// environment block -- not the SYSTEM service's own context. On success it
// returns the launched process's PID, so callers that need to track
// liveness later (see agent/internal/service's tray supervision logic)
// don't need to re-derive it themselves.
func RunAsSession(sessionID uint32, exe string, args []string) (pid uint32, err error) {
	return runAsToken(sessionID, exe, args)
}

// runAsToken is the shared implementation behind RunAsSession: query the
// logged-in user's own token for sessionID and hand it to launchWithToken.
func runAsToken(sessionID uint32, exe string, args []string) (pid uint32, err error) {
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

	return launchWithToken(userToken, exe, args, sessionID)
}

// RunAsSessionAsSystem launches exe (with args) attached to sessionID's own
// window station/desktop, but using the agent service's own SYSTEM token
// instead of the logged-in user's -- Beacon's "Elevate" mechanism. Unlike
// the split-token-Administrator approach this replaced, SYSTEM needs no
// credentials of any kind (it's already the token the calling process
// holds) and, critically, is the one privilege level that can actually
// open and interact with Windows' secure desktop (the separate desktop a
// UAC consent/credential prompt renders on) -- an Administrator token,
// split-token or not, cannot open it at all, which is exactly why the
// previous Administrator-token mechanism could see an elevated window via
// screen capture but could never see or click through a UAC prompt itself.
//
// The agent service's own live process token (from OpenProcessToken on
// GetCurrentProcess) cannot have SetTokenInformation's TokenSessionId
// applied directly -- that call is documented to fail on a token currently
// in use as a running process's own primary token. Duplicated into a
// fresh, not-yet-assigned copy first; launchWithToken below duplicates it
// again into the final primary token handed to CreateProcessAsUser, so
// this is two duplications total, not one -- a real, easy-to-get-wrong
// detail distinct from every other RunAsSession* variant, none of which
// start from an already-in-use token.
//
// GENUINELY FRAGILE, not yet verified on real hardware -- same category as
// this codebase's other hand-derived Windows internals (the SES SigV4
// signer, the SendInput INPUT struct layout). Relocating a duplicate of
// the service's own running SYSTEM token to a different session is new to
// this codebase; if this doesn't work in practice, the double-duplication
// step above is the first thing to re-examine.
func RunAsSessionAsSystem(sessionID uint32, exe string, args []string) (pid uint32, err error) {
	self, err := windows.GetCurrentProcess()
	if err != nil {
		return 0, fmt.Errorf("usersession: get current process: %w", err)
	}
	var procToken windows.Token
	if err := windows.OpenProcessToken(self, windows.TOKEN_QUERY|windows.TOKEN_DUPLICATE, &procToken); err != nil {
		return 0, fmt.Errorf("usersession: open process token: %w", err)
	}
	defer procToken.Close()

	var dupToken windows.Token
	if err := windows.DuplicateTokenEx(
		procToken,
		windows.TOKEN_ALL_ACCESS,
		nil,
		windows.SecurityImpersonation,
		windows.TokenPrimary,
		&dupToken,
	); err != nil {
		return 0, fmt.Errorf("usersession: duplicate system token: %w", err)
	}
	defer dupToken.Close()

	if err := enableTcbPrivilege(); err != nil {
		return 0, fmt.Errorf("usersession: enable SE_TCB_NAME: %w", err)
	}

	sid := sessionID
	if err := windows.SetTokenInformation(
		dupToken,
		windows.TokenSessionId,
		(*byte)(unsafe.Pointer(&sid)),
		uint32(unsafe.Sizeof(sid)),
	); err != nil {
		return 0, fmt.Errorf("usersession: set token session: %w", err)
	}

	return launchWithToken(dupToken, exe, args, sessionID)
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
// RunAsSessionAsSystem: duplicate the given token into a primary token,
// build its environment block, and CreateProcessAsUser onto sessionID's
// desktop. token is expected to already be scoped to sessionID --
// WTSQueryUserToken's result always is; RunAsSessionAsSystem forces this
// via SetTokenInformation before calling in here. This is byte-for-byte
// the same sequence RunAsSession already used before this function was
// extracted out of runAsToken -- its own real-hardware verification still
// covers it.
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
