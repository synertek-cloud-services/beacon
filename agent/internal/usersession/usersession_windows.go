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

// RunAsSession launches exe (with args) in the context of whoever is logged
// into the given session ID, using that user's own primary token and
// environment block -- not the SYSTEM service's own context. On success it
// returns the launched process's PID, so callers that need to track
// liveness later (see agent/internal/service's tray supervision logic)
// don't need to re-derive it themselves.
func RunAsSession(sessionID uint32, exe string, args []string) (pid uint32, err error) {
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

	// CreateProcessAsUser specifically requires a primary token, not just an
	// impersonation-level token -- the most common mistake in a hand-rolled
	// version of this pattern.
	var primaryToken windows.Token
	if err := windows.DuplicateTokenEx(
		userToken,
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
