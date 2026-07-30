//go:build windows

package service

import (
	"log"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
)

// stopWaitTimeout bounds how long Execute waits for the loop goroutine to
// actually exit after a Stop/Shutdown request before giving up and
// returning anyway. Set generously above checkInInterval's worst case (an
// in-flight HTTP check-in plus its own timeouts) -- this is a last-resort
// safety valve, not the expected path; the loop is expected to observe
// stop and return promptly.
const stopWaitTimeout = 15 * time.Second

type handler struct{ loop func(stop <-chan struct{}) }

// Execute previously reported StopPending/Stopped to SCM and returned
// immediately without ever signaling the `go h.loop()` goroutine to stop or
// waiting for it to exit -- a real bug found in production: goroutines don't
// die when the function that launched them returns, so the SCM handshake
// completed genuinely (Stopped was not a lie), while the actual process --
// and its check-in loop -- kept running indefinitely, completely orphaned
// from SCM's bookkeeping. `Get-Service` correctly showed Stopped while the
// agent kept checking in, since "the service" (as far as SCM's Execute/
// Status protocol is concerned) and "the OS process" had silently diverged.
func (h *handler) Execute(_ []string, r <-chan svc.ChangeRequest, s chan<- svc.Status) (bool, uint32) {
	s <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown | svc.AcceptSessionChange}

	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		h.loop(stop)
		close(done)
	}()

	for c := range r {
		switch c.Cmd {
		case svc.SessionChange:
			// EventData points to a WTSSESSION_NOTIFICATION for session-change
			// events; only WTS_SESSION_LOGON matters here (someone just logged
			// into the console) -- everything else (lock/unlock/disconnect/etc.)
			// is ignored. Run in its own goroutine: EnsureTrayRunning does I/O
			// (extraction, process launch) and must never block this loop from
			// picking up the next control request, including a Stop.
			if c.EventType == windows.WTS_SESSION_LOGON {
				go EnsureTrayRunning()
			}
		case svc.Stop, svc.Shutdown:
			// WaitHint tells SCM how long to stay patient before it
			// considers the service hung -- without this, SCM's default
			// patience can be too short for a check-in that's mid-flight
			// when the stop arrives.
			s <- svc.Status{State: svc.StopPending, WaitHint: uint32(stopWaitTimeout.Milliseconds())}
			close(stop)
			select {
			case <-done:
			case <-time.After(stopWaitTimeout):
				log.Printf("service: loop did not exit within %s of stop request — reporting stopped anyway", stopWaitTimeout)
			}
			return false, 0
		}
	}
	return false, 0
}

// Run starts the agent loop. When invoked by the Windows service manager it
// wraps the loop in svc.Run; otherwise runs it directly (interactive/dev).
// loop must select on stop and return promptly when it's closed -- a nil
// stop channel (the interactive/dev path) simply never fires that case,
// since receiving from a nil channel blocks forever, which is exactly the
// "never stop this way" behavior interactive/dev mode wants (Ctrl-C still
// kills the process at the OS level, independent of this mechanism).
func Run(loop func(stop <-chan struct{})) {
	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Printf("service: cannot detect run mode (%v) — running interactively", err)
		loop(nil)
		return
	}
	if isService {
		if err := svc.Run(ServiceName, &handler{loop: loop}); err != nil {
			log.Fatalf("service: svc.Run: %v", err)
		}
	} else {
		loop(nil)
	}
}
