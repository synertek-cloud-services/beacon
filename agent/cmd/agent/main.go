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

	"github.com/synertek-cloud-services/beacon/agent/internal/auconfig"
	"github.com/synertek-cloud-services/beacon/agent/internal/audit"
	"github.com/synertek-cloud-services/beacon/agent/internal/credential"
	"github.com/synertek-cloud-services/beacon/agent/internal/discovery"
	"github.com/synertek-cloud-services/beacon/agent/internal/executor"
	"github.com/synertek-cloud-services/beacon/agent/internal/filesize"
	"github.com/synertek-cloud-services/beacon/agent/internal/inventory"
	"github.com/synertek-cloud-services/beacon/agent/internal/muconfig"
	"github.com/synertek-cloud-services/beacon/agent/internal/pingutil"
	"github.com/synertek-cloud-services/beacon/agent/internal/procutil"
	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
	"github.com/synertek-cloud-services/beacon/agent/internal/rebootmarker"
	"github.com/synertek-cloud-services/beacon/agent/internal/service"
	"github.com/synertek-cloud-services/beacon/agent/internal/session"
	"github.com/synertek-cloud-services/beacon/agent/internal/svcutil"
	"github.com/synertek-cloud-services/beacon/agent/internal/updater"
	"github.com/synertek-cloud-services/beacon/agent/internal/usersession"
	"github.com/synertek-cloud-services/beacon/agent/internal/wingetupdate"
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
	pendingMu                        sync.Mutex
	pendingResults                   []protocol.CommandResult
	pendingFileSizeResults           []protocol.FileSizeResult
	pendingPingResults               []protocol.PingResult
	pendingProcessResults            []protocol.ProcessResult
	pendingServiceResults            []protocol.ServiceResult
	pendingWindowsUpdateDriftResults []protocol.WindowsUpdateDriftResult
	auditTrigger                     = make(chan struct{}, 1)
	// triggerCheckin lets command goroutines wake the main loop early so
	// results are reported on the next check-in rather than waiting the
	// full 60-second interval. Buffered so senders never block.
	triggerCheckin = make(chan struct{}, 1)
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

	serverURL := flag.String("server-url", "", "Beacon worker URL (required)")
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
		token := *enrollToken
		if token == "" {
			bootstrap, bootstrapErr := credential.LoadEnrollmentBootstrap()
			if bootstrapErr != nil {
				log.Fatal("no stored credential and no --enroll-token or enrollment bootstrap provided")
			}
			if bootstrap.ServerURL != *serverURL {
				log.Fatal("enrollment bootstrap server URL does not match --server-url")
			}
			token = bootstrap.Token
		}
		cred, err = enroll(client, token)
		if err != nil {
			log.Fatalf("enrollment: %v", err)
		}
		if err := credential.RemoveEnrollmentBootstrap(); err != nil && !os.IsNotExist(err) {
			log.Printf("remove enrollment bootstrap: %v", err)
		}
	} else if err := credential.RemoveEnrollmentBootstrap(); err != nil && !os.IsNotExist(err) {
		// A repair install may have written a bootstrap token before the service
		// discovered its existing device identity. Never retain that stale token.
		log.Printf("remove stale enrollment bootstrap: %v", err)
	}

	log.Printf("beacon agent %s — device %s", version, cred.DeviceID)

	// Self-healing recovery-action config (Windows-only; no-op elsewhere) --
	// runs before the updater starts so a device that never had this set
	// (enrolled before it existed, or manually stripped) gets it before it
	// ever attempts a self-update swap. See Reharden's doc comment in
	// internal/service/install_windows.go for why this matters: self-update
	// relies entirely on pre-configured SCM recovery actions to survive its
	// own exit. (This used to also apply tamper-resistance SDDL/ACL locking
	// under the same call -- deliberately removed, see that same doc
	// comment.)
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
		// interval starts at the default and is replaced every iteration by
		// whatever checkIn() decides for the *next* cycle -- normally
		// checkInInterval, but shortened while the worker reports an active
		// fast-poll window for this device (see checkIn's own doc comment,
		// worker/src/lib/fastPoll.ts). Orthogonal to triggerCheckin below:
		// that's a one-shot early wake for the *current* sleep only, with
		// no memory across iterations, so the two never need to coordinate.
		interval := checkInInterval
		for {
			next, err := checkIn(client, cred)
			if err != nil {
				log.Printf("check-in error: %v", err)
			} else {
				updater.NotifyCheckIn()
			}
			interval = next
			// Resilience net for the tray icon (Windows-only; no-op
			// elsewhere) -- piggybacks on this existing check-in cadence
			// rather than a separate ticker. Catches a crashed/killed tray
			// or a missed session-change event; the hook in
			// runner_windows.go is just a latency optimization on top of
			// this, not a replacement.
			service.EnsureTrayRunning()
			// Same piggyback cadence -- see pollPendingReboot's own doc
			// comment for why this is polled state, not a named pipe.
			pollPendingReboot()
			select {
			case <-time.After(interval):
			case <-triggerCheckin:
				// A command result arrived — check in early to report it
				// before the full interval elapses (important for commands
				// like reboot that shut the machine down shortly after).
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
// stderr. Best-effort: if MkdirAll itself fails (e.g. this is the very
// first run before enrollment has ever created credDir on some platform),
// logging just stays on stderr and nothing else changes.
//
// Root-caused live against a real production device: checking in and
// executing commands correctly for days with a completely silent agent.log,
// traced to a single un-retried OpenFile call losing a sharing-mode race at
// service startup (most likely an AV/EDR scan of the freshly-created/
// freshly-swapped file). Since a Windows service has no console for the
// stderr fallback to reach anyone, that one lost race silently blacked out
// logging for the entire remaining life of the process -- the whole reason
// this function exists in the first place.
//
// A first fix used a short bounded retry (5 attempts, 2.5s total) -- proven
// insufficient by the very next real restart of that same device: the
// process came back up as a confirmed-different PID running the fix, yet
// agent.log still never got a single new line, while a manual file-open
// test moments later succeeded immediately (the lock had since cleared).
// The startup contention window can outlast a few hundred ms, apparently
// by a wide margin right after a binary swap/restart when AV activity is
// heaviest -- so instead of a bounded synchronous retry that can still
// lose, the first attempt happens synchronously (covers the common
// zero-delay case, doesn't hold up main() at all when it just works), and
// on failure a background goroutine keeps retrying every 5s, indefinitely,
// until it succeeds -- log.SetOutput is safe to call concurrently with
// other log.Printf calls (the stdlib Logger's own mutex covers it), so
// logging recovers automatically whenever the file becomes available
// rather than staying silently blacked out for the rest of the process's
// life.
func setupLogging(credDir string) {
	if err := os.MkdirAll(credDir, 0o755); err != nil {
		return
	}
	logPath := filepath.Join(credDir, "agent.log")
	if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
		log.SetOutput(io.MultiWriter(os.Stderr, f))
		return
	}
	go func() {
		for {
			time.Sleep(5 * time.Second)
			f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
			if err != nil {
				continue
			}
			log.SetOutput(io.MultiWriter(os.Stderr, f))
			log.Printf("agent.log opened (delayed -- initial attempt lost a startup sharing-mode race)")
			return
		}
	}()
}

func runInstall() {
	fs := flag.NewFlagSet("install", flag.ExitOnError)
	serverURL := fs.String("server-url", "", "Beacon worker URL (required)")
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
	if err := prepareEnrollmentBootstrap(*serverURL, *enrollToken); err != nil {
		log.Fatalf("prepare enrollment bootstrap: %v", err)
	}
	if err := service.Install(*serverURL); err != nil {
		if removeErr := credential.RemoveEnrollmentBootstrap(); removeErr != nil && !os.IsNotExist(removeErr) {
			log.Printf("remove enrollment bootstrap after failed install: %v", removeErr)
		}
		log.Fatalf("install: %v", err)
	}
}

// prepareEnrollmentBootstrap writes an enrollment token only for a fresh
// installation. A repair runs against an agent that already has its device
// credential, so persisting its deployment token would leave unnecessary
// sensitive material on disk.
func prepareEnrollmentBootstrap(serverURL, enrollToken string) error {
	if _, err := credential.Load(); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("loading existing credential: %w", err)
	}
	return credential.SaveEnrollmentBootstrap(serverURL, enrollToken)
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

// checkIn returns the interval the main loop should sleep before its next
// call -- normally checkInInterval, but shortened when the worker reports
// an active fast-poll window for this device (CheckInResponse.
// NextCheckinSeconds, see worker/src/lib/fastPoll.ts). Every early-return
// error path defaults to checkInInterval rather than trying to preserve
// whatever interval was previously in effect -- there's no fresher signal
// to base a smarter choice on when a check-in itself just failed.
func checkIn(client *protocol.Client, cred *credential.Stored) (time.Duration, error) {
	snap, err := inventory.Collect()
	if err != nil {
		return checkInInterval, fmt.Errorf("inventory: %w", err)
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
	windowsUpdateDriftResults := pendingWindowsUpdateDriftResults
	pendingWindowsUpdateDriftResults = nil
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
		PendingCommandResults:            results,
		PendingFileSizeResults:           fileSizeResults,
		PendingPingResults:               pingResults,
		PendingProcessResults:            processResults,
		PendingServiceResults:            serviceResults,
		PendingWindowsUpdateDriftResults: windowsUpdateDriftResults,
	})
	if err != nil {
		pendingMu.Lock()
		pendingResults = append(results, pendingResults...)
		pendingFileSizeResults = append(fileSizeResults, pendingFileSizeResults...)
		pendingPingResults = append(pingResults, pendingPingResults...)
		pendingProcessResults = append(processResults, pendingProcessResults...)
		pendingServiceResults = append(serviceResults, pendingServiceResults...)
		pendingWindowsUpdateDriftResults = append(windowsUpdateDriftResults, pendingWindowsUpdateDriftResults...)
		pendingMu.Unlock()
		return checkInInterval, err
	}

	// Piggybacks on this same 60s cadence rather than a separate poll loop
	// or the check-in wire protocol itself -- support_url is pure one-way
	// config with no round trip, deliberately kept out of CheckInRequest/
	// CheckInResponse (see BrandingIdentity's own doc comment). Non-fatal:
	// a transient fetch failure is logged and skipped, never treated as a
	// check-in failure.
	if identity, err := client.BrandingIdentity(); err != nil {
		log.Printf("branding identity fetch: %v", err)
	} else {
		service.SetSupportURL(identity.SupportURL)
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

	for _, chk := range resp.WindowsUpdateDriftChecks {
		go func(chk protocol.WindowsUpdateDriftCheck) {
			r := auconfig.Read()
			pendingMu.Lock()
			pendingWindowsUpdateDriftResults = append(pendingWindowsUpdateDriftResults, protocol.WindowsUpdateDriftResult{
				MonitorID:    chk.MonitorID,
				NoAutoUpdate: r.NoAutoUpdate,
				AUOptions:    r.AUOptions,
				Error:        r.Error,
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
			if cmd.Type == "uninstall_agent" {
				// No result is ever reported back for this one, same as
				// restart_agent above — by design, since the device
				// disappearing from check-ins entirely *is* the proof of
				// success. service.SelfUninstall() (not Uninstall(), which
				// is for the separate `beacon-agent uninstall` CLI
				// invocation) spawns a detached helper and returns
				// immediately, specifically so this process can exit
				// cleanly right after rather than trying to out-live its
				// own service stop — see its doc comment for why that
				// matters.
				log.Printf("uninstall_agent received — self-uninstalling")
				if err := service.SelfUninstall(); err != nil {
					log.Printf("uninstall_agent: %v", err)
					return
				}
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
					UpdateIDs  []string `json:"update_ids"`
					AutoReboot bool     `json:"auto_reboot"`
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
						// auto_reboot is only ever set by a Patch Policy dispatch
						// (worker/src/lib/patchPolicies.ts) -- the manual per-device
						// dashboard route never sends it, so this always falls
						// through to the interactive tray prompt for that path.
						if payload.AutoReboot {
							log.Printf("install_patches: auto_reboot enabled, rebooting immediately")
							if err := exec.Command("shutdown", "/r", "/t", "0").Run(); err != nil {
								log.Printf("install_patches: auto-reboot shutdown command failed: %v", err)
							}
						} else {
							writePendingRebootMarker()
						}
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
			if cmd.Type == "network_scan" {
				// SNMP/SSH are optional, additive fields -- a dispatch from
				// before Credentialed Network Discovery (issue #78), or one
				// from a company with no CV_SNMP_COMMUNITY/CV_SSH_USERNAME/
				// CV_SSH_PASSWORD Company Variables configured, simply omits
				// them, and discovery.Scan behaves exactly as it always has.
				var payload struct {
					CIDRRanges []string `json:"cidr_ranges"`
					SNMP       *struct {
						Community string `json:"community"`
					} `json:"snmp,omitempty"`
					SSH *struct {
						Username string `json:"username"`
						Password string `json:"password"`
					} `json:"ssh,omitempty"`
				}
				status := "completed"
				var stdout, stderr string
				if err := json.Unmarshal(cmd.Payload, &payload); err != nil {
					status = "failed"
					stderr = fmt.Sprintf("invalid payload: %v", err)
				} else {
					log.Printf("network_scan received: %d range(s)", len(payload.CIDRRanges))
					var snmpCommunity, sshUsername, sshPassword string
					if payload.SNMP != nil {
						snmpCommunity = payload.SNMP.Community
					}
					if payload.SSH != nil {
						sshUsername = payload.SSH.Username
						sshPassword = payload.SSH.Password
					}
					res := discovery.Scan(payload.CIDRRanges, snmpCommunity, sshUsername, sshPassword)
					if res.Error != "" {
						status = "failed"
						stderr = res.Error
					}
					summary, _ := json.Marshal(res)
					stdout = string(summary)
					log.Printf("network_scan finished: %d host(s) found", len(res.Hosts))
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
			if cmd.Type == "list_remote_sessions" {
				// Windows-only, matching install_msi_other.go/
				// run_as_user_other.go's mixed-OS-fleet convention: fails
				// clearly with real stderr rather than silently reporting
				// an empty list, which would misleadingly read as
				// "confirmed zero active sessions." No payload needed --
				// this is a pure query, not configured per-dispatch.
				status := "completed"
				var stdout, stderr string
				sessions, err := usersession.ActiveSessionDetails()
				if err != nil {
					status = "failed"
					stderr = fmt.Sprintf("list remote sessions: %v", err)
				} else {
					out, _ := json.Marshal(sessions)
					stdout = string(out)
					log.Printf("list_remote_sessions: %d active session(s)", len(sessions))
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
			if cmd.Type == "manage_windows_update" {
				var payload struct {
					Action     string `json:"action"`
					PriorState *struct {
						NoAutoUpdate *int `json:"no_auto_update"`
						AUOptions    *int `json:"au_options"`
					} `json:"prior_state"`
				}
				status := "completed"
				var stdout, stderr string
				if err := json.Unmarshal(cmd.Payload, &payload); err != nil {
					status = "failed"
					stderr = fmt.Sprintf("invalid payload: %v", err)
				} else {
					var priorNoAutoUpdate, priorAUOptions *int
					if payload.PriorState != nil {
						priorNoAutoUpdate = payload.PriorState.NoAutoUpdate
						priorAUOptions = payload.PriorState.AUOptions
					}
					log.Printf("manage_windows_update received: action=%s", payload.Action)
					res := auconfig.Apply(payload.Action, priorNoAutoUpdate, priorAUOptions)
					if res.Error != "" {
						status = "failed"
						stderr = res.Error
					}
					summary, _ := json.Marshal(res)
					stdout = string(summary)
					log.Printf("manage_windows_update finished: applied=%v", res.Applied)
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
			if cmd.Type == "manage_software" {
				var payload struct {
					PackageIDs []string `json:"package_ids"`
				}
				status := "completed"
				var stdout, stderr string
				if err := json.Unmarshal(cmd.Payload, &payload); err != nil {
					status = "failed"
					stderr = fmt.Sprintf("invalid payload: %v", err)
				} else {
					log.Printf("manage_software received: %d package id(s)", len(payload.PackageIDs))
					res := wingetupdate.Upgrade(payload.PackageIDs)
					if res.Error != "" {
						status = "failed"
						stderr = res.Error
					} else if !res.AllOK {
						status = "failed"
						stderr = "one or more winget invocations failed -- see stdout for the full output"
					}
					stdout = res.Output
					log.Printf("manage_software finished: all_ok=%v", res.AllOK)
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
			if cmd.Type == "manage_microsoft_update" {
				var payload struct {
					Action     string `json:"action"`
					PriorState *struct {
						WasRegistered *bool `json:"was_registered"`
					} `json:"prior_state"`
				}
				status := "completed"
				var stdout, stderr string
				if err := json.Unmarshal(cmd.Payload, &payload); err != nil {
					status = "failed"
					stderr = fmt.Sprintf("invalid payload: %v", err)
				} else {
					var priorRegistered *bool
					if payload.PriorState != nil {
						priorRegistered = payload.PriorState.WasRegistered
					}
					log.Printf("manage_microsoft_update received: action=%s", payload.Action)
					res := muconfig.Apply(payload.Action, priorRegistered)
					if res.Error != "" {
						status = "failed"
						stderr = res.Error
					}
					summary, _ := json.Marshal(res)
					stdout = string(summary)
					log.Printf("manage_microsoft_update finished: applied=%v", res.Applied)
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
				// Every other command handler does this to report its result
				// within ~2s instead of waiting up to the full 60s interval --
				// this one specifically needs it more than most: if an update
				// really is available, updater.ForceCheck() (above) races to
				// download+verify+swap the running binary, which replaces this
				// process (wiping pendingResults) before the next unprompted
				// check-in would otherwise fire. Without this nudge, that race
				// is lost almost every time an update actually applies, and the
				// command sits at "sent" forever in the dashboard even though
				// the update itself succeeded.
				select {
				case triggerCheckin <- struct{}{}:
				default:
				}
				return
			}
			log.Printf("executing command %s (type: %s)", cmd.CommandID, cmd.Type)
			result := executor.Execute(cmd, client, cred.DeviceCredential)
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

	nextInterval := checkInInterval
	if resp.NextCheckinSeconds > 0 {
		nextInterval = time.Duration(resp.NextCheckinSeconds) * time.Second
	}
	return nextInterval, nil
}

// rebootMarker is the on-disk state shared between the agent and
// beacon-tray.exe (agent/internal/rebootmarker.Path) -- a
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
	path := rebootmarker.Path()
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
	path := rebootmarker.Path()
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
