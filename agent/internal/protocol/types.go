package protocol

import "encoding/json"

type DeviceClass string

const (
	DeviceClassServer      DeviceClass = "server"
	DeviceClassWorkstation DeviceClass = "workstation"
	DeviceClassLaptop      DeviceClass = "laptop"
)

// EnrollRequest is sent once on first run to exchange an enrollment token
// for a long-lived device credential.
type EnrollRequest struct {
	Hostname      string      `json:"hostname"`
	OSType        string      `json:"os_type"`
	OSVersion     string      `json:"os_version"`
	AgentVersion  string      `json:"agent_version"`
	DetectedClass DeviceClass `json:"detected_class"`
}

// EnrollResponse carries the issued device credential and initial approval status.
// A credential is always returned — pending devices can still check in;
// status controls command eligibility, not data ingestion.
type EnrollResponse struct {
	DeviceID         string `json:"device_id"`
	TenantID         string `json:"tenant_id"`
	DeviceCredential string `json:"device_credential"`
	Status           string `json:"status"` // "pending" | "approved"
}

// CheckInRequest is posted to /v1/check-in on every heartbeat.
type CheckInRequest struct {
	DeviceID              string          `json:"device_id"`
	TenantID              string          `json:"tenant_id"`
	Timestamp             int64           `json:"timestamp"`
	AgentVersion          string          `json:"agent_version"`
	Metrics               Metrics         `json:"metrics"`
	PendingCommandResults []CommandResult `json:"pending_command_results"`
}

// Metrics is the Phase 1 inventory payload. New fields can be added here in
// later phases without breaking old agents reading the response.
type Metrics struct {
	Hostname      string      `json:"hostname"`
	OSType        string      `json:"os_type"`
	OSVersion     string      `json:"os_version"`
	UptimeSeconds int64       `json:"uptime_seconds"`
	DiskFreeBytes int64       `json:"disk_free_bytes"`
	DetectedClass DeviceClass `json:"detected_class"`
}

// CheckInResponse is returned by the server. Commands is omitted when empty.
type CheckInResponse struct {
	Commands []Command `json:"commands,omitempty"`
}

// Command is a unit of work issued by the server. The agent executes known
// types and silently ignores unknown ones for forward compatibility.
type Command struct {
	CommandID string          `json:"command_id"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

// CommandResult reports the outcome of a previously issued Command, piggybacked
// on the next check-in to avoid a separate request type.
type CommandResult struct {
	CommandID string `json:"command_id"`
	Status    string `json:"status"` // "completed" | "failed"
	Stdout    string `json:"stdout"`
	Stderr    string `json:"stderr"`
	ExitCode  int    `json:"exit_code"`
}
