//go:build !windows

package usersession

import "errors"

// ErrNoActiveSession mirrors the Windows build's sentinel so callers can
// share the same error-handling path regardless of platform.
var ErrNoActiveSession = errors.New("usersession: not supported on this platform")

// RunAsActiveUser is a no-op stub outside Windows -- there's no equivalent
// Session 0 Isolation concept on Linux/macOS for this package to bridge.
func RunAsActiveUser(exe string, args []string) error {
	return ErrNoActiveSession
}
