package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/synertek-cloud-services/beacon/agent/internal/audit"
	"github.com/synertek-cloud-services/beacon/agent/internal/credential"
	"github.com/synertek-cloud-services/beacon/agent/internal/executor"
	"github.com/synertek-cloud-services/beacon/agent/internal/filesize"
	"github.com/synertek-cloud-services/beacon/agent/internal/inventory"
	"github.com/synertek-cloud-services/beacon/agent/internal/pingutil"
	"github.com/synertek-cloud-services/beacon/agent/internal/procutil"
	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
	"github.com/synertek-cloud-services/beacon/agent/internal/service"
	"github.com/synertek-cloud-services/beacon/agent/internal/session"
	"github.com/synertek-cloud-services/beacon/agent/internal/svcutil"
	"github.com/synertek-cloud-services/beacon/agent/internal/updater"
	"github.com/synertek-cloud-services/beacon/agent/internal/wuinstall"
)

// version is a var, not a const, so `go build -ldflags="-X main.version=..."`
// (used by scripts/publish-agent.mjs) can actually override it at build time
// -- linker -X only works on package-level string variables, silently no-ops
// on a const. Defaults to this value for plain `go build`/`make` invocations
// that don't pass ldflags.
var version = "0.2.9"

const checkInInterval = 60 * time.Second

var (
	pendingMu              sync.Mutex
	pendingResults         []protocol.CommandResult
	pendingFileSizeResults []protocol.FileSizeResult
	pendingPingResults     []protocol.PingResult
	pendingProcessResults  []protocol.ProcessResult
	pendingServiceResults  []protocol.ServiceResult
	auditTrigger           = make(chan struct{}, 1)
	// triggerCheckin lets command goroutines wake the main loop early so
	// results are reported on the next check-in rather than waiting the
	// full 60-second interval. Buffered so senders never block.
	triggerCheckin         = make(chan struct{}, 1)
)

func main() {
	// Windows services have no visible console — without this, every
	// updater/audit/check-in log line goes nowhere anyone can ever see,
	// which made a real production self-update failure indistinguishable
	// from "hasn't tried yet" for an entire debugging session. credential.Dir()
	// is a pure path computation (no I/O), safe to call before enrollment.
	setupLogging(credential.Dir())

	// Handle install/uninstall subcommands before the normal flag set.
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "install":
			runInstall()
			return
		case "uninstall":
			if err := service.Uninstall(); err != nil {
				log.Fatalf("uninstall: %v", err)
			}
			return
		}
	}

	serverURL   := flag.String("server-url", "", "Beacon worker URL (required)")
	enrollToken := flag.String("enroll-token", "", "Enrollment token (required on first run)")
	flag.Parse()

	if *serverURL == "" {
		log.Fatal("--server-url is required")
	}

	client := protocol.NewClient(*serverURL)

	cred, err := credential.Load()
	if err != nil {
		if !os.IsNotExist(err) {
			log.Fatalf("loading credential: %v", err)
		}
		if *enrollToken == "" {
			log.Fatal("no stored credential and no --enroll-token provided")
		}
		cred, err = enroll(client, *enrollToken)
		if err != nil {
			log.Fatalf("enrollment: %v", err)
		}
	}

	log.Printf("beacon agent %s — device %s", version, cred.DeviceID)

	// Self-healing tamper-resistance hardening (Windows-only; no-op
	// elsewhere) -- runs before the updater starts so a device that was
	// never hardened (enrolled before this existed, or manually stripped)
	// is protected before it ever attempts a self-update swap. See
	// Reharden's doc comment in internal/service/install_windows.go for
	// why this matters: self-update relies entirely on pre-configured SCM
	// recovery actions to survive its own exit.
	service.Reharden()

	// Tray icon lifecycle (Windows-only; no-op elsewhere). SetAgentVersion
	// must be called before any EnsureTrayRunning call -- see its own doc
	// comment for why version is package-level state rather than a
	// parameter (the session-change hook in runner_windows.go calls
	// EnsureTrayRunning too, with no access to this local `version`).
	// This first call covers "agent starts, someone's already logged in";
	// the check-in loop below covers everything after.
	service.SetAgentVersion(version)
	service.EnsureTrayRunning()

	updater.Start(*serverURL, version, credential.Dir())
	audit.Start(client, cred.DeviceCredential, cred.DeviceID, cred.TenantID, version, auditTrigger)

	service.Run(func(stop <-chan struct{}) {
		for {
			if err := checkIn(client, cred); err != nil {
				log.Printf("check-in error: %v", err)
			} else {
				updater.NotifyCheckIn()
			}
			// Resilience net for the tray icon (Windows-only; no-op
			// elsewhere) -- piggybacks on this existing 60s cadence rather
			// than a separate ticker. Catches a crashed/killed tray or a
			// missed session-change event; the hook in runner_windows.go is
			// just a latency optimization on top of this, not a replacement.
			service.EnsureTrayRunning()
			// Same piggyback cadence -- see pollPendingReboot's own doc
			// comment for why this is polled state, not a named pipe.
			pollPendingReboot()
			select {
			case <-time.After(checkInInterval):
			case <-triggerCheckin:
				// A command result arrived — check in early to report it
				// before the full 60-second interval elapses (important for
				// commands like reboot that shut the machine down shortly after).
				time.Sleep(2 * time.Second)
			case <-stop:
				// Windows service stop/shutdown request (see runner_windows.go)
				// -- must actually return here, not just acknowledge it, or
				// this goroutine keeps running orphaned from SCM forever.
				return
			}
		}
	})
}

// setupLogging appends log output to <credDir>/agent.log in addition to
// stderr. Best-effort: if the directory/file can't be created (e.g. this
// is the very first run before enrollment has ever created credDir on some
// platform), logging just stays on stderr and nothing else changes.
func setupLogging(credDir string) {
	if err := os.MkdirAll(credDir, 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(credDir, "agent.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	log.SetOutput(io.MultiWriter(os.Stderr, f))
}

func runInstall() {
	fs := flag.NewFlagSet("install", flag.ExitOnError)
	serverURL   := fs.String("server-url", "", "Beacon worker URL (required)")
	enrollToken := fs.String("enroll-token", "", "Enrollment token (required)")
	fs.Parse(os.Args[2:])

	if *serverURL == "" {
		fmt.Fprintln(os.Stderr, "install: --server-url is required")
		fs.Usage()
		os.Exit(1)
	}
	if *enrollToken == "" {
		fmt.Fprintln(os.Stderr, "install: --enroll-token is required")
		fs.Usage()
		os.Exit(1)
	}
	if err := service.Install(*serverURL, *enrollToken); err != nil {
		log.Fatalf("install: %v", err)
	}
}

func enroll(client *protocol.Client, token string) (*credential.Stored, error) {
	snap, err := inventory.Collect()
	if err != nil {
		return nil, fmt.Errorf("inventory: %w", err)
	}
	resp, err := client.Enroll(token, protocol.EnrollRequest{
		Hostname:      snap.Hostname,
		OSType:        snap.OSType,
		OSVersion:     snap.OSVersion,
		AgentVersion:  version,
		DetectedClass: protocol.DeviceClass(snap.DetectedClass),
	})
	if err != nil {
		return nil, err
	}
	cred := &credential.Stored{
		DeviceID:         resp.DeviceID,
		TenantID:         resp.TenantID,
		DeviceCredential: resp.DeviceCredential,
	}
	if err := credential.Save(cred); err != nil {
		return nil, fmt.Errorf("saving credential: %w", err)
	}
	log.Printf("enrolled: device %s, status %s", resp.DeviceID, resp.Status)
	return cred, nil
}

func checkIn(client *protocol.Client, cred *credential.Stored) error {
	snap, err := inventory.Collect()
	if err != nil {
		return fmt.Errorf("inventory: %w", err)
	}

	pendingMu.Lock()
	results := pendingResults
	pendingResults = nil
	fileSizeResults := pendingFileSizeResults
	pendingFileSizeResults = nil
	pingResults := pendingPingResults
	pendingPingResults = nil
	processResults := pendingProcessResults
	pendingProcessResults = nil
	serviceResults := pendingServiceResults
	pendingServiceResults = nil
	pendingMu.Unlock()

	resp, err := client.CheckIn(cred.DeviceCredential, protocol.CheckInRequest{
		DeviceID:     cred.DeviceID,
		TenantID:     cred.TenantID,
		Timestamp:    time.Now().Unix(),
		AgentVersion: version,
		Metrics: protocol.Metrics{
			Hostname:      snap.Hostname,
			OSType:        snap.OSType,
			OSVersion:     snap.OSVersion,
			UptimeSeconds: snap.UptimeSeconds,
			DiskFreeBytes: snap.DiskFreeBytes,
			Disks:         snap.Disks,
			DetectedClass: protocol.DeviceClass(snap.DetectedClass),
			CpuPercent:    snap.CpuPercent,
			MemoryPercent: snap.MemoryPercent,
			AvStatus:      snap.AvStatus,
			AvProduct:     snap.AvProduct,
		},
		PendingCommandResults:  results,
		PendingFileSizeResults: fileSizeResults,
		PendingPingResults:     pingResults,
		PendingProcessResults:  processResults,
		PendingServiceResults:  serviceResults,
	})
	if err != nil {
		pendingMu.Lock()
		pendingResults = append(results, pendingResults...)
		pendingFileSizeResults = append(fileSizeResults, pendingFileSizeResults...)
		pendingPingResults = append(pingResults, pendingPingResults...)
		pendingProcessResults = append(processResults, pendingProcessResults...)
		pendingServiceResults = append(serviceResults, pendingServiceResults...)
		pendingMu.Unlock()
		return err
	}

	for _, chk := range resp.ServiceChecks {
		go func(chk protocol.ServiceCheck) {
			running, cpu, mem := svcutil.Find(chk.ServiceName)
			pendingMu.Lock()
			pendingServiceResults = append(pendingServiceResults, protocol.ServiceResult{
				MonitorID:  chk.MonitorID,
				Running:    running,
				CpuPercent: cpu,
				MemPercent: mem,
			})
			pendingMu.Unlock()
		}(chk)
	}

	for _, chk := range resp.ProcessChecks {
		go func(chk protocol.ProcessCheck) {
			running, cpu, mem := procutil.Find(chk.ProcessName)
			pendingMu.Lock()
			pendingProcessResults = append(pendingProcessResults, protocol.ProcessResult{
				MonitorID:  chk.MonitorID,
				Running:    running,
				CpuPercent: cpu,
				MemPercent: mem,
			})
			pendingMu.Unlock()
		}(chk)
	}

	for _, chk := range resp.PingChecks {
		go func(chk protocol.PingCheck) {
			sent, received, avgRtt := pingutil.Ping(chk.Target, chk.Count)
			pendingMu.Lock()
			pendingPingResults = append(pendingPingResults, protocol.PingResult{
				MonitorID:       chk.MonitorID,
				PacketsSent:     sent,
				PacketsReceived: received,
				AvgRttMs:        avgRtt,
			})
			pendingMu.Unlock()
		}(chk)
	}

	for _, chk := range resp.FileSizeChecks {
		go func(chk protocol.FileSizeCheck) {
			exists, size, err := filesize.Measure(chk.Path)
			if err != nil {
				log.Printf("file_size measure %s: %v", chk.Path, err)
				return
			}
			pendingMu.Lock()
			pendingFileSizeResults = append(pendingFileSizeResults, protocol.FileSizeResult{
				MonitorID: chk.MonitorID,
				Exists:    exists,
				SizeBytes: size,
			})
			pendingMu.Unlock()
		}(chk)
	}

	for _, cmd := range resp.Commands {
		go func(cmd protocol.Command) {
			if cmd.Type == "open_session" {
				session.Handle(cmd)
				return
			}
			if cmd.Type == "restart_agent" {
				log.Printf("restart_agent received — exiting for SCM recovery restart")
				os.Exit(0)
			}
			if cmd.Type == "run_audit" {
				select {
				case auditTrigger <- struct{}{}:
				default:
				}
				pendingMu.Lock()
				pendingResults = append(pendingResults, protocol.CommandResult{
					CommandID: cmd.CommandID,
					Status:    "completed",
					Stdout:    "audit triggered",
				})
				pendingMu.Unlock()
				return
			}
			if cmd.Type == "install_patches" {
				var payload struct {
					UpdateIDs []string `json:"update_ids"`
				}
				status := "completed"
				var stdout, stderr string
				if err := json.Unmarshal(cmd.Payload, &payload); err != nil {
					status = "failed"
					stderr = fmt.Sprintf("invalid payload: %v", err)
				} else {
					log.Printf("install_patches received: %d update(s)", len(payload.UpdateIDs))
					res := wuinstall.Install(payload.UpdateIDs)
					if res.Error != "" {
						status = "failed"
						stderr = res.Error
					}
					summary, _ := json.Marshal(res)
					stdout = string(summary)
					log.Printf("install_patches finished: reboot_required=%v", res.RebootRequired)
					if res.RebootRequired {
						writePendingRebootMarker()
					}
				}
				pendingMu.Lock()
				pendingResults = append(pendingResults, protocol.CommandResult{
					CommandID: cmd.CommandID,
					Status:    status,
					Stdout:    stdout,
					Stderr:    stderr,
				})
				pendingMu.Unlock()
				select {
				case triggerCheckin <- struct{}{}:
				default:
				}
				return
			}
			if cmd.Type == "force_update" {
				// Reuses the agent's own verified self-update path (Ed25519
				// signature check included) instead of a separate unsigned
				// download-and-swap, unlike the ComStore "Reinstall Agent"
				// script -- this just wakes updater.runLoop early rather than
				// waiting up to 24h for its next scheduled check.
				updater.ForceCheck()
				pendingMu.Lock()
				pendingResults = append(pendingResults, protocol.CommandResult{
					CommandID: cmd.CommandID,
					Status:    "completed",
					Stdout:    "update check triggered",
				})
				pendingMu.Unlock()
				return
			}
			log.Printf("executing command %s (type: %s)", cmd.CommandID, cmd.Type)
			result := executor.Execute(cmd)
			log.Printf("command %s finished: status=%s exit_code=%d", cmd.CommandID, result.Status, result.ExitCode)
			pendingMu.Lock()
			pendingResults = append(pendingResults, result)
			pendingMu.Unlock()
			select {
			case triggerCheckin <- struct{}{}:
			default:
			}
		}(cmd)
	}

	return nil
}

// rebootMarker is the on-disk state shared between the agent and
// beacon-tray.exe (agent/internal/service.PendingRebootMarkerPath) -- a
// polled file rather than a named pipe, deliberately, since a reboot
// prompt isn't latency-critical and this avoids real Windows IPC
// connection-lifecycle complexity for marginal benefit. SnoozedUntil==0
// means not currently snoozed; Confirmed is set by the tray once the user
// picks "Restart Now" -- the agent (not the tray) performs the actual
// reboot, matching the established "the agent always does the actual
// privileged action" pattern the rest of patch install already follows.
type rebootMarker struct {
	CreatedAt    int64 `json:"created_at"`
	SnoozedUntil int64 `json:"snoozed_until"`
	Confirmed    bool  `json:"confirmed"`
}

// writePendingRebootMarker creates the marker if one doesn't already exist
// -- never clobbers an in-progress snooze from a previous install's prompt
// that the user hasn't responded to yet.
func writePendingRebootMarker() {
	path := service.PendingRebootMarkerPath()
	if path == "" {
		return // non-Windows; no-op
	}
	if _, err := os.Stat(path); err == nil {
		return // already pending, leave any existing snooze state alone
	}
	data, _ := json.Marshal(rebootMarker{CreatedAt: time.Now().Unix()})
	if err := os.WriteFile(path, data, 0o644); err != nil {
		log.Printf("write pending-reboot marker: %v", err)
	}
}

// pollPendingReboot checks whether the user has confirmed a pending reboot
// via the tray prompt and, if so, actually performs it -- same shutdown
// invocation worker/src/routes/admin/devices.ts's "reboot" command already
// uses, for consistency. Best-effort: any error here just gets logged, not
// escalated, since this runs unconditionally on every check-in tick.
func pollPendingReboot() {
	path := service.PendingRebootMarkerPath()
	if path == "" {
		return // non-Windows; no-op
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return // no marker -- nothing pending
	}
	var m rebootMarker
	if err := json.Unmarshal(data, &m); err != nil {
		return
	}
	if !m.Confirmed {
		return
	}
	log.Printf("reboot confirmed via tray prompt -- restarting")
	os.Remove(path)
	if err := exec.Command("shutdown", "/r", "/t", "0").Run(); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
