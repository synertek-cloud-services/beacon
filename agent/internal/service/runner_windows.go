//go:build windows

package service

import (
	"log"

	"golang.org/x/sys/windows/svc"
)

type handler struct{ loop func() }

func (h *handler) Execute(_ []string, r <-chan svc.ChangeRequest, s chan<- svc.Status) (bool, uint32) {
	s <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	go h.loop()
	for c := range r {
		switch c.Cmd {
		case svc.Stop, svc.Shutdown:
			s <- svc.Status{State: svc.StopPending}
			return false, 0
		}
	}
	return false, 0
}

// Run starts the agent loop. When invoked by the Windows service manager it
// wraps the loop in svc.Run; otherwise runs it directly (interactive/dev).
func Run(loop func()) {
	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Printf("service: cannot detect run mode (%v) — running interactively", err)
		loop()
		return
	}
	if isService {
		if err := svc.Run(ServiceName, &handler{loop: loop}); err != nil {
			log.Fatalf("service: svc.Run: %v", err)
		}
	} else {
		loop()
	}
}
