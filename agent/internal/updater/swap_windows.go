//go:build windows

package updater

import (
	"os"
	"os/exec"

	"golang.org/x/sys/windows/svc"
)

// atomicSwap on Windows: rename the running exe (allowed — Windows locks by
// handle, not by name), put the new binary in its place, start the new process,
// then exit so the service manager can clean up.
func atomicSwap(exe, newPath, backupPath string) error {
	if err := copyFile(exe, backupPath); err != nil {
		return err
	}

	// Rename away the currently-running binary (allowed on Windows).
	if err := os.Rename(exe, backupPath); err != nil {
		os.Remove(backupPath)
		return err
	}

	// Move new binary into the vacated slot.
	if err := os.Rename(newPath, exe); err != nil {
		// Try to put the old binary back.
		os.Rename(backupPath, exe)
		return err
	}

	// When running as a Windows service, SCM recovery actions (set during
	// install) will restart the service with the new binary — don't spawn a
	// second process or we get two instances running simultaneously.
	if isWinService() {
		os.Exit(0)
	}

	// Dev / interactive: start new process directly then exit.
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		// Rollback: put old binary back.
		os.Rename(backupPath, exe)
		return err
	}
	os.Exit(0)
	return nil
}

func rollback(exe, backupPath string) error {
	if err := os.Rename(backupPath, exe); err != nil {
		return err
	}
	if isWinService() {
		os.Exit(0)
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	os.Exit(0)
	return nil
}

func isWinService() bool {
	ok, _ := svc.IsWindowsService()
	return ok
}
