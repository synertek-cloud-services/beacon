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

// SessionDetail mirrors the Windows build's type (including JSON tags) so
// cross-platform callers need no build-tag split of their own.
type SessionDetail struct {
	SessionID uint32 `json:"session_id"`
	Username  string `json:"username"`
	IsConsole bool   `json:"is_console"`
}

// ActiveSessionDetails is a no-op stub outside Windows. Unlike
// ActiveSessions (used only for internal per-session iteration, where an
// empty result is a harmless no-op), this backs a user-facing "list
// sessions to pick from" command -- an empty list would misleadingly read
// as "confirmed zero active sessions" rather than "not supported on this
// platform," so this returns an error instead, matching every other
// session-launch stub in this file.
func ActiveSessionDetails() ([]SessionDetail, error) {
	return nil, ErrNoActiveSession
}

// CurrentSessionID is a no-op stub outside Windows -- there's no WTS
// session concept to resolve. beacon-screenshare.exe itself is a
// Windows-only binary; this stub exists purely so the usersession package
// as a whole stays cross-platform buildable for its other, genuinely
// cross-platform callers (agent/cmd/agent, agent/tools/usersessiontest).
func CurrentSessionID() (uint32, error) {
	return 0, ErrNoActiveSession
}

// UsernameForSession is a no-op stub outside Windows, matching CurrentSessionID.
func UsernameForSession(sessionID uint32) (string, error) {
	return "", ErrNoActiveSession
}
