//go:build !windows

package service

// Run calls loop directly on non-Windows platforms. A nil stop channel is
// passed -- receiving from it blocks forever, so loop's `case <-stop:`
// branch simply never fires. Process termination on these platforms is
// handled by systemd/launchd sending a real OS signal, not by this
// in-process mechanism (which exists specifically to fix a Windows-only
// SCM stop-handshake bug -- see runner_windows.go).
func Run(loop func(stop <-chan struct{})) { loop(nil) }
