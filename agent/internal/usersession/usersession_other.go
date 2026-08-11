//go:build !windows

package usersession

import "errors"

// ErrNoActiveSession mirrors the Windows build's sentinel so callers can
// share the same error-handling path regardless of platform.
var ErrNoActiveSession = errors.New("usersession: not supported on this platform")

// ActiveConsoleSessionID is a no-op stub outside Windows, matching RunAsActiveUser.
func ActiveConsoleSessionID() (uint32, error) {
	return 0, ErrNoActiveSession
}

// RunAsActiveUser is a no-op stub outside Windows -- there's no equivalent
// Session 0 Isolation concept on Linux/macOS for this package to bridge.
func RunAsActiveUser(exe string, args []string) (pid uint32, err error) {
	return 0, ErrNoActiveSession
}

// RunAsSession is a no-op stub outside Windows, matching RunAsActiveUser.
func RunAsSession(sessionID uint32, exe string, args []string) (pid uint32, err error) {
	return 0, ErrNoActiveSession
}

// RunAsSessionAsSystem is a no-op stub outside Windows, matching RunAsSession.
func RunAsSessionAsSystem(sessionID uint32, exe string, args []string) (pid uint32, err error) {
	return 0, ErrNoActiveSession
}

// ActiveSessions is a no-op stub outside Windows -- always empty.
func ActiveSessions() ([]uint32, error) {
	return nil, nil
}
