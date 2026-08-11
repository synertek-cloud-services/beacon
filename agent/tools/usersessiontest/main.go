// usersessiontest is a standalone verification tool for
// agent/internal/usersession -- not part of the shipped agent. It must be
// run as SYSTEM to meaningfully test RunAsActiveUser or RunAsSessionAsSystem,
// since WTSQueryUserToken (and, for -system, OpenProcessToken on the
// calling process's own token plus SetTokenInformation) requires the
// "Act as part of the operating system" privilege that only SYSTEM holds
// by default -- running this as a mere Administrator will not exercise
// the real code path the agent service actually uses, and can produce a
// misleading access-denied failure that has nothing to do with whether
// the primitive itself works.
//
// Also logs to a file, not just stdout -- there's no visible console when
// this is launched via a SYSTEM-context scheduled task (the standard way to
// actually get SYSTEM privileges for a manual test like this one).
//
// Usage: usersessiontest.exe [-system] <exe> [args...]
// Example: usersessiontest.exe notepad.exe
// Example: usersessiontest.exe -system notepad.exe   (Elevate's SYSTEM path)
package main

import (
	"flag"
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

	system := flag.Bool("system", false, "test RunAsSessionAsSystem (Elevate's SYSTEM-relaunch mechanism) against the console session, instead of RunAsActiveUser")
	flag.Parse()
	args := flag.Args()
	if len(args) < 1 {
		logger.Println("usage: usersessiontest.exe [-system] <exe> [args...]")
		os.Exit(1)
	}
	exe := args[0]
	exeArgs := args[1:]

	if *system {
		logger.Printf("attempting RunAsSessionAsSystem against the console session (%q, %v)", exe, exeArgs)
		sessionID, err := usersession.ActiveConsoleSessionID()
		if err == usersession.ErrNoActiveSession {
			logger.Println("RESULT: no active console session (expected/clean no-op) -- ErrNoActiveSession")
			return
		}
		if err != nil {
			logger.Printf("RESULT: FAILED to resolve console session: %v", err)
			os.Exit(1)
		}
		pid, err := usersession.RunAsSessionAsSystem(sessionID, exe, exeArgs)
		if err != nil {
			logger.Printf("RESULT: FAILED: %v", err)
			os.Exit(1)
		}
		logger.Printf("RESULT: launched successfully as SYSTEM, pid=%d, session=%d -- check the active console session for the process (it should show SYSTEM as its user in Task Manager's Details tab)", pid, sessionID)
		fmt.Println("log written to", logPath)
		return
	}

	logger.Printf("attempting RunAsActiveUser(%q, %v)", exe, exeArgs)
	pid, err := usersession.RunAsActiveUser(exe, exeArgs)
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
