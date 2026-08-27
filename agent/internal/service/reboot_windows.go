//go:build windows

package service

import (
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/synertek-cloud-services/beacon/agent/internal/credential"
	"github.com/synertek-cloud-services/beacon/agent/internal/traypipe"
)

// rebootState replaces the old on-disk pending-reboot.json marker (see
// agent/internal/rebootmarker, deleted alongside this file) as the
// authoritative reboot-confirmation state. SnoozedUntil's zero value means
// "not currently snoozed"; Confirmed is set once the user picks "Restart
// Now" in the tray prompt -- the agent (not the tray) performs the actual
// reboot, matching the established "the agent always does the actual
// privileged action" pattern the rest of patch install already follows.
type rebootState struct {
	pending      bool
	confirmed    bool
	snoozedUntil time.Time
}

var (
	rebootMu sync.Mutex
	reboot   rebootState
)

// rebootBreadcrumbPath is SYSTEM-only, read and written exclusively by this
// process -- unlike the old pending-reboot.json, which lived in the
// install directory and needed a non-admin BUILTIN\Users write grant
// (via icacls) for the tray to answer it directly. Now the tray only ever
// talks to this state over the pipe; nothing outside this process ever
// opens this file, so no ACL grant is needed at all. Mirrors
// agent/internal/updater's own update-state.json convention (same
// credential.Dir() location, same 0o600, same plain os.ReadFile/WriteFile +
// JSON shape) -- this exists purely so a reboot that's pending or already
// confirmed survives an agent *service* restart (self-update,
// restart_agent), not to communicate with the tray.
func rebootBreadcrumbPath() string {
	return filepath.Join(credential.Dir(), "reboot-pending.json")
}

type rebootBreadcrumb struct {
	Pending      bool      `json:"pending"`
	Confirmed    bool      `json:"confirmed"`
	SnoozedUntil time.Time `json:"snoozed_until,omitempty"`
}

func saveRebootBreadcrumb() {
	data, err := json.Marshal(rebootBreadcrumb{
		Pending:      reboot.pending,
		Confirmed:    reboot.confirmed,
		SnoozedUntil: reboot.snoozedUntil,
	})
	if err != nil {
		return
	}
	if err := os.WriteFile(rebootBreadcrumbPath(), data, 0o600); err != nil {
		log.Printf("service: reboot: save breadcrumb: %v", err)
	}
}

// LoadRebootState restores reboot state left over from before an agent
// service restart. Call once at startup, alongside SetAgentVersion.
func LoadRebootState() {
	data, err := os.ReadFile(rebootBreadcrumbPath())
	if err != nil {
		return // no breadcrumb -- nothing was pending, nothing to restore
	}
	var b rebootBreadcrumb
	if err := json.Unmarshal(data, &b); err != nil {
		return
	}
	rebootMu.Lock()
	reboot = rebootState{pending: b.Pending, confirmed: b.Confirmed, snoozedUntil: b.SnoozedUntil}
	rebootMu.Unlock()
}

// RequestReboot records that a reboot is needed and pushes a prompt to
// every currently-connected tray. Replaces writePendingRebootMarker --
// called from the same install_patches call site in agent/cmd/agent/main.go.
// No-ops if a reboot is already pending, same as the old marker's
// "never clobber an in-progress snooze" behavior.
func RequestReboot() {
	rebootMu.Lock()
	if reboot.pending {
		rebootMu.Unlock()
		return
	}
	reboot = rebootState{pending: true}
	rebootMu.Unlock()
	saveRebootBreadcrumb()
	broadcastRebootPrompt()
}

// ProcessRebootState is the reboot half of the check-in-tick resilience
// loop, replacing pollPendingReboot. Two jobs: perform the actual shutdown
// once confirmed, and re-prompt once an active snooze expires.
func ProcessRebootState() {
	rebootMu.Lock()
	pending, confirmed, snoozedUntil := reboot.pending, reboot.confirmed, reboot.snoozedUntil
	rebootMu.Unlock()

	if !pending {
		return
	}

	if confirmed {
		log.Printf("reboot confirmed via tray prompt -- restarting")
		if err := exec.Command("shutdown", "/r", "/t", "0").Run(); err != nil {
			// Preserves the exact fix from the marker-era "infinite loop"
			// bug: state is only cleared *after* a successful shutdown call.
			// A failed call here leaves pending+confirmed exactly as they
			// were, so the very next check-in tick retries automatically
			// instead of silently discarding the user's answer.
			log.Printf("shutdown: %v (will retry on next check-in)", err)
			return
		}
		rebootMu.Lock()
		reboot = rebootState{}
		rebootMu.Unlock()
		os.Remove(rebootBreadcrumbPath())
		return
	}

	if !snoozedUntil.IsZero() && time.Now().After(snoozedUntil) {
		rebootMu.Lock()
		reboot.snoozedUntil = time.Time{}
		rebootMu.Unlock()
		saveRebootBreadcrumb()
		broadcastRebootPrompt()
	}
}

// handleRebootResponse processes an inbound TypeRebootResponse from a tray
// connection. The actual shutdown call, if confirmed, happens on the next
// check-in tick via ProcessRebootState -- not inline here on the
// pipe-reader goroutine -- keeping the privileged action on the same
// predictable cadence every other agent action already uses.
func handleRebootResponse(payload json.RawMessage) {
	var r traypipe.RebootResponsePayload
	if err := json.Unmarshal(payload, &r); err != nil {
		return
	}
	rebootMu.Lock()
	if !reboot.pending {
		rebootMu.Unlock()
		return // stale response for an already-resolved/reverted reboot
	}
	if r.Confirmed {
		reboot.confirmed = true
	} else {
		reboot.confirmed = false
		reboot.snoozedUntil = time.Now().Add(time.Hour)
	}
	rebootMu.Unlock()
	saveRebootBreadcrumb()
}

// broadcastRebootPrompt pushes TypeRebootPrompt to every connected tray --
// used both for a brand-new reboot request and for a snooze-expiry
// re-prompt (replacing the tray's own 30s re-poll-after-snooze behavior;
// this is now entirely server-driven).
func broadcastRebootPrompt() {
	trayMu.Lock()
	conns := make([]*traypipe.Conn, 0, len(connections))
	for _, c := range connections {
		conns = append(conns, c)
	}
	trayMu.Unlock()

	for _, c := range conns {
		if err := c.Send(traypipe.TypeRebootPrompt, traypipe.RebootPromptPayload{}); err != nil {
			log.Printf("service: reboot: pipe broadcast reboot_prompt: %v", err)
		}
	}
}

// rebootPromptOutstanding reports whether a fresh connection should
// immediately be sent a reboot prompt -- covers a session connecting (or
// reconnecting) after the prompt already started, e.g. the tray restarting
// mid-prompt or a technician remoting in after the prompt fired.
func rebootPromptOutstanding() bool {
	rebootMu.Lock()
	defer rebootMu.Unlock()
	if !reboot.pending || reboot.confirmed {
		return false
	}
	return reboot.snoozedUntil.IsZero() || time.Now().After(reboot.snoozedUntil)
}
