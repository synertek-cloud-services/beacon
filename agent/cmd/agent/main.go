package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/synertekcs/beacon/agent/internal/audit"
	"github.com/synertekcs/beacon/agent/internal/credential"
	"github.com/synertekcs/beacon/agent/internal/executor"
	"github.com/synertekcs/beacon/agent/internal/inventory"
	"github.com/synertekcs/beacon/agent/internal/protocol"
	"github.com/synertekcs/beacon/agent/internal/service"
	"github.com/synertekcs/beacon/agent/internal/session"
	"github.com/synertekcs/beacon/agent/internal/updater"
)

const (
	version         = "0.1.0"
	checkInInterval = 60 * time.Second
)

var (
	pendingMu      sync.Mutex
	pendingResults []protocol.CommandResult
	auditTrigger   = make(chan struct{}, 1)
)

func main() {
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

	updater.Start(*serverURL, version, credential.Dir())
	audit.Start(client, cred.DeviceCredential, cred.DeviceID, cred.TenantID, version, auditTrigger)

	service.Run(func() {
		for {
			if err := checkIn(client, cred); err != nil {
				log.Printf("check-in error: %v", err)
			} else {
				updater.NotifyCheckIn()
			}
			time.Sleep(checkInInterval)
		}
	})
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
			DetectedClass: protocol.DeviceClass(snap.DetectedClass),
			CpuPercent:    snap.CpuPercent,
			MemoryPercent: snap.MemoryPercent,
		},
		PendingCommandResults: results,
	})
	if err != nil {
		pendingMu.Lock()
		pendingResults = append(results, pendingResults...)
		pendingMu.Unlock()
		return err
	}

	for _, cmd := range resp.Commands {
		go func(cmd protocol.Command) {
			if cmd.Type == "open_session" {
				session.Handle(cmd)
				return
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
			log.Printf("executing command %s (type: %s)", cmd.CommandID, cmd.Type)
			result := executor.Execute(cmd)
			log.Printf("command %s finished: status=%s exit_code=%d", cmd.CommandID, result.Status, result.ExitCode)
			pendingMu.Lock()
			pendingResults = append(pendingResults, result)
			pendingMu.Unlock()
		}(cmd)
	}

	return nil
}
