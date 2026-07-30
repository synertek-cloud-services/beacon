// usersessiontest is a standalone verification tool for
// agent/internal/usersession -- not part of the shipped agent. It must be
// run as SYSTEM to meaningfully test RunAsActiveUser, since
// WTSQueryUserToken requires the "Act as part of the operating system"
// privilege that only SYSTEM holds by default -- running this as a mere
// Administrator will not exercise the real code path the agent service
// actually uses, and can produce a misleading access-denied failure that
// has nothing to do with whether the primitive itself works.
//
// Also logs to a file, not just stdout -- there's no visible console when
// this is launched via a SYSTEM-context scheduled task (the standard way to
// actually get SYSTEM privileges for a manual test like this one).
//
// Usage: usersessiontest.exe <exe> [args...]
// Example: usersessiontest.exe notepad.exe
package main

import (
	"fmt"
	"io"
	"log"
	"os"

	"github.com/synertek-cloud-services/beacon/agent/internal/usersession"
)

func main() {
	logPath := `C:\Temp\usersessiontest.log`
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	var out io.Writer = os.Stdout
	if err == nil {
		defer f.Close()
		out = io.MultiWriter(os.Stdout, f)
	}
	logger := log.New(out, "", log.LstdFlags)

	if len(os.Args) < 2 {
		logger.Println("usage: usersessiontest.exe <exe> [args...]")
		os.Exit(1)
	}
	exe := os.Args[1]
	args := os.Args[2:]

	logger.Printf("attempting RunAsActiveUser(%q, %v)", exe, args)
	pid, err := usersession.RunAsActiveUser(exe, args)
	if err == usersession.ErrNoActiveSession {
		logger.Println("RESULT: no active console session (expected/clean no-op) -- ErrNoActiveSession")
		return
	}
	if err != nil {
		logger.Printf("RESULT: FAILED: %v", err)
		os.Exit(1)
	}
	logger.Printf("RESULT: launched successfully, pid=%d -- check the active console session for the process", pid)
	fmt.Println("log written to", logPath)
}
