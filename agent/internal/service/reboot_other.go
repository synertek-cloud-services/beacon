//go:build !windows

package service

// The reboot-prompt workflow is Windows-only (it exists to drive the tray's
// MessageBox), same as EnsureTrayRunning's own no-op stub. Kept unconditional
// so agent/cmd/agent/main.go's call sites don't need build tags of their own.
func LoadRebootState()   {}
func RequestReboot()     {}
func ProcessRebootState() {}
