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
// logged into the active console session, using that user's own primary
// token and environment block -- not the SYSTEM service's own context.
func RunAsActiveUser(exe string, args []string) error {
	sessionID := windows.WTSGetActiveConsoleSessionId()
	if sessionID == 0xFFFFFFFF {
		log.Printf("usersession: no active console session")
		return ErrNoActiveSession
	}

	var userToken windows.Token
	if err := windows.WTSQueryUserToken(sessionID, &userToken); err != nil {
		// A console session ID with no queryable user token happens right
		// at the login/lock-screen transition -- treat the same as "no
		// session" rather than a hard error.
		log.Printf("usersession: session %d has no queryable user token: %v", sessionID, err)
		return ErrNoActiveSession
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
		return fmt.Errorf("usersession: duplicate token: %w", err)
	}
	defer primaryToken.Close()

	var envBlock *uint16
	if err := windows.CreateEnvironmentBlock(&envBlock, primaryToken, false); err != nil {
		return fmt.Errorf("usersession: create environment block: %w", err)
	}
	defer windows.DestroyEnvironmentBlock(envBlock)

	cmdLine, err := commandLine(exe, args)
	if err != nil {
		return fmt.Errorf("usersession: %w", err)
	}
	cmdLinePtr, err := windows.UTF16PtrFromString(cmdLine)
	if err != nil {
		return fmt.Errorf("usersession: encode command line: %w", err)
	}
	desktop, err := windows.UTF16PtrFromString(`winsta0\default`)
	if err != nil {
		return fmt.Errorf("usersession: encode desktop: %w", err)
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
		windows.CREATE_UNICODE_ENVIRONMENT|windows.CREATE_NEW_CONSOLE,
		envBlock,
		nil, // currentDir -- inherit
		&si,
		&pi,
	)
	if err != nil {
		return fmt.Errorf("usersession: create process as user: %w", err)
	}
	defer windows.CloseHandle(pi.Process)
	defer windows.CloseHandle(pi.Thread)

	log.Printf("usersession: launched pid %d in session %d", pi.ProcessId, sessionID)
	return nil
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
