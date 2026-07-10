package audit

import (
	"log"
	"time"

	"github.com/synertekcs/beacon/agent/internal/protocol"
)

// Start launches the audit scheduler as a background goroutine.
// It waits initialDelay before the first audit, then repeats every interval.
// A receive on triggerCh fires an immediate audit (non-blocking channel send from caller).
func Start(
	client *protocol.Client,
	deviceCredential string,
	deviceID string,
	tenantID string,
	agentVersion string,
	triggerCh <-chan struct{},
) {
	go run(client, deviceCredential, deviceID, tenantID, agentVersion, triggerCh)
}

func run(
	client *protocol.Client,
	deviceCredential string,
	deviceID string,
	tenantID string,
	agentVersion string,
	triggerCh <-chan struct{},
) {
	// Wait 5 minutes after startup before the first full audit so enrollment
	// and initial check-ins complete first.
	select {
	case <-time.After(5 * time.Minute):
	case <-triggerCh:
	}

	sendAudit(client, deviceCredential, deviceID, tenantID, agentVersion)

	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			sendAudit(client, deviceCredential, deviceID, tenantID, agentVersion)
		case <-triggerCh:
			sendAudit(client, deviceCredential, deviceID, tenantID, agentVersion)
		}
	}
}

func sendAudit(
	client *protocol.Client,
	deviceCredential string,
	deviceID string,
	tenantID string,
	agentVersion string,
) {
	payload := protocol.AuditPayload{}

	if hw, err := collectHardware(); err != nil {
		log.Printf("audit: hardware collection failed: %v", err)
	} else {
		payload.Hardware = hw
	}

	if sw, err := collectSoftware(); err != nil {
		log.Printf("audit: software collection failed: %v", err)
	} else {
		payload.Software = sw
	}

	if svcs, err := collectServices(); err != nil {
		log.Printf("audit: services collection failed: %v", err)
	} else {
		payload.Services = svcs
	}

	if sec, err := collectSecurity(); err != nil {
		log.Printf("audit: security collection failed: %v", err)
	} else {
		payload.Security = sec
	}

	req := protocol.AuditRequest{
		DeviceID:     deviceID,
		TenantID:     tenantID,
		Timestamp:    time.Now().Unix(),
		AgentVersion: agentVersion,
		Payload:      payload,
	}

	resp, err := client.Audit(deviceCredential, req)
	if err != nil {
		log.Printf("audit: POST /v1/audit failed: %v", err)
		return
	}
	log.Printf("audit: submitted audit_id=%s", resp.AuditID)
}
