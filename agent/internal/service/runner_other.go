//go:build !windows

package service

// Run calls loop directly on non-Windows platforms.
func Run(loop func()) { loop() }
