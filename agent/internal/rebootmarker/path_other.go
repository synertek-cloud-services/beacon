//go:build !windows

package rebootmarker

// Path is empty because the pending-reboot tray workflow is Windows-only.
func Path() string { return "" }
