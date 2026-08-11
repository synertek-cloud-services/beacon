//go:build !windows

package usersession

import "errors"

// ErrNoActiveSession mirrors the Windows build's sentinel so callers can
// share the same error-handling path regardless of platform.
var ErrNoActiveSession = errors.New("usersession: not supported on this platform")

// ErrElevationNotAvailable mirrors the Windows build's sentinel, same
// reason as ErrNoActiveSession above.
var ErrElevationNotAvailable = errors.New("usersession: not supported on this platform")

// ErrInvalidCredentials mirrors the Windows build's sentinel, same reason
// as ErrNoActiveSession above.
var ErrInvalidCredentials = errors.New("usersession: not supported on this platform")

// ActiveUserCanElevate is a no-op stub outside Windows -- there's no
// equivalent split-token/UAC concept on Linux/macOS.
func ActiveUserCanElevate() (bool, error) {
	return false, ErrNoActiveSession
}

// RunAsActiveUser is a no-op stub outside Windows -- there's no equivalent
// Session 0 Isolation concept on Linux/macOS for this package to bridge.
func RunAsActiveUser(exe string, args []string) (pid uint32, err error) {
	return 0, ErrNoActiveSession
}

// RunAsActiveUserElevated is a no-op stub outside Windows, matching RunAsActiveUser.
func RunAsActiveUserElevated(exe string, args []string) (pid uint32, err error) {
	return 0, ErrNoActiveSession
}

// RunAsSession is a no-op stub outside Windows, matching RunAsActiveUser.
func RunAsSession(sessionID uint32, exe string, args []string) (pid uint32, err error) {
	return 0, ErrNoActiveSession
}

// RunAsSessionElevated is a no-op stub outside Windows, matching RunAsSession.
func RunAsSessionElevated(sessionID uint32, exe string, args []string) (pid uint32, err error) {
	return 0, ErrNoActiveSession
}

// RunAsActiveUserWithCredentials is a no-op stub outside Windows, matching RunAsActiveUser.
func RunAsActiveUserWithCredentials(exe string, args []string, username, password string) (pid uint32, err error) {
	return 0, ErrNoActiveSession
}

// RunAsSessionWithCredentials is a no-op stub outside Windows, matching RunAsSession.
func RunAsSessionWithCredentials(sessionID uint32, exe string, args []string, username, password string) (pid uint32, err error) {
	return 0, ErrNoActiveSession
}

// ActiveSessions is a no-op stub outside Windows -- always empty.
func ActiveSessions() ([]uint32, error) {
	return nil, nil
}
