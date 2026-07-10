package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/synertekcs/beacon/agent/internal/credential"
	"github.com/synertekcs/beacon/agent/internal/inventory"
	"github.com/synertekcs/beacon/agent/internal/protocol"
)

const (
	version             = "0.1.0"
	checkInInterval     = 60 * time.Second
)

func main() {
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

	for {
		if err := checkIn(client, cred); err != nil {
			log.Printf("check-in error: %v", err)
		}
		time.Sleep(checkInInterval)
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
		},
		PendingCommandResults: []protocol.CommandResult{},
	})
	if err != nil {
		return err
	}

	// Phase 2: dispatch resp.Commands
	_ = resp
	return nil
}
