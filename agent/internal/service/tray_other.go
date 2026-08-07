//go:build !windows

package service

// SetAgentVersion, EnsureTrayRunning, and SetSupportURL are Windows-only
// concepts (there's no tray icon or Session 0 Isolation equivalent on
// Linux/macOS) -- no-op stubs so main.go doesn't need platform-specific
// call sites.
func SetAgentVersion(v string) {}

func EnsureTrayRunning() {}

func SetSupportURL(u string) {}
