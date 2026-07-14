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
	DeviceID               string           `json:"device_id"`
	TenantID               string           `json:"tenant_id"`
	Timestamp              int64            `json:"timestamp"`
	AgentVersion           string           `json:"agent_version"`
	Metrics                Metrics          `json:"metrics"`
	PendingCommandResults  []CommandResult  `json:"pending_command_results"`
	PendingFileSizeResults []FileSizeResult `json:"pending_file_size_results,omitempty"`
	PendingPingResults     []PingResult     `json:"pending_ping_results,omitempty"`
	PendingProcessResults  []ProcessResult  `json:"pending_process_results,omitempty"`
	PendingServiceResults  []ServiceResult  `json:"pending_service_results,omitempty"`
}

// Metrics is the Phase 1 inventory payload. New fields can be added here in
// later phases without breaking old agents reading the response.
type Metrics struct {
	Hostname      string      `json:"hostname"`
	OSType        string      `json:"os_type"`
	OSVersion     string      `json:"os_version"`
	UptimeSeconds int64       `json:"uptime_seconds"`
	DiskFreeBytes int64       `json:"disk_free_bytes"`
	Disks         []DiskInfo  `json:"disks,omitempty"`
	DetectedClass DeviceClass `json:"detected_class"`
	CpuPercent    float64     `json:"cpu_percent"`
	MemoryPercent float64     `json:"memory_percent"`
	// av_status: "running_up_to_date" | "running_not_up_to_date" | "not_running" | "not_detected" | "" (unsupported platform)
	AvStatus  string `json:"av_status,omitempty"`
	AvProduct string `json:"av_product,omitempty"` // name of detected AV product
}

// CheckInResponse is returned by the server. Commands is omitted when empty.
type CheckInResponse struct {
	Commands       []Command       `json:"commands,omitempty"`
	FileSizeChecks []FileSizeCheck `json:"file_size_checks,omitempty"`
	PingChecks     []PingCheck     `json:"ping_checks,omitempty"`
	ProcessChecks  []ProcessCheck  `json:"process_checks,omitempty"`
	ServiceChecks  []ServiceCheck  `json:"service_checks,omitempty"`
}

// FileSizeCheck asks the agent to measure a path for a file_size monitor.
// The agent measures it async and reports the result on the next check-in.
type FileSizeCheck struct {
	MonitorID string `json:"monitor_id"`
	Path      string `json:"path"`
}

// FileSizeResult reports a measurement taken in response to a FileSizeCheck.
type FileSizeResult struct {
	MonitorID string `json:"monitor_id"`
	Exists    bool   `json:"exists"`
	SizeBytes int64  `json:"size_bytes"`
}

// PingCheck asks the agent to ICMP-ping a target for a ping monitor. The
// agent measures it async and reports the result on the next check-in.
type PingCheck struct {
	MonitorID string `json:"monitor_id"`
	Target    string `json:"target"`
	Count     int    `json:"count"`
}

// PingResult reports the outcome of a previously issued PingCheck.
type PingResult struct {
	MonitorID       string  `json:"monitor_id"`
	PacketsSent     int     `json:"packets_sent"`
	PacketsReceived int     `json:"packets_received"`
	AvgRttMs        float64 `json:"avg_rtt_ms"`
}

// ProcessCheck asks the agent to look up a named process for a process
// monitor. The agent measures it async and reports the result on the next
// check-in.
type ProcessCheck struct {
	MonitorID   string `json:"monitor_id"`
	ProcessName string `json:"process_name"`
}

// ProcessResult reports the outcome of a previously issued ProcessCheck.
type ProcessResult struct {
	MonitorID  string  `json:"monitor_id"`
	Running    bool    `json:"running"`
	CpuPercent float64 `json:"cpu_percent"`
	MemPercent float64 `json:"mem_percent"`
}

// ServiceCheck asks the agent to look up a named Windows service for a
// service monitor. The agent measures it async and reports the result on
// the next check-in.
type ServiceCheck struct {
	MonitorID   string `json:"monitor_id"`
	ServiceName string `json:"service_name"`
}

// ServiceResult reports the outcome of a previously issued ServiceCheck.
type ServiceResult struct {
	MonitorID  string  `json:"monitor_id"`
	Running    bool    `json:"running"`
	CpuPercent float64 `json:"cpu_percent"`
	MemPercent float64 `json:"mem_percent"`
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

// ── Inventory Audit ───────────────────────────────────────────────────────────

// AuditRequest is posted to /v1/audit independently of the heartbeat check-in.
// The agent always sends a full snapshot; the server computes deltas.
type AuditRequest struct {
	DeviceID     string       `json:"device_id"`
	TenantID     string       `json:"tenant_id"`
	Timestamp    int64        `json:"timestamp"`
	AgentVersion string       `json:"agent_version"`
	Payload      AuditPayload `json:"payload"`
}

type AuditPayload struct {
	Hardware *HardwareInfo  `json:"hardware,omitempty"`
	Software []SoftwareItem `json:"software,omitempty"`
	Services []ServiceItem  `json:"services,omitempty"`
	Security *SecurityInfo  `json:"security,omitempty"`
}

type HardwareInfo struct {
	CPU              []CPUInfo     `json:"cpu"`
	RAM              RAMInfo       `json:"ram"`
	Disks            []DiskInfo    `json:"disks"`
	Network          []NetworkInfo `json:"network"`
	BIOS             *BIOSInfo     `json:"bios,omitempty"`
	LastLoggedInUser string        `json:"last_logged_in_user,omitempty"`
}

type CPUInfo struct {
	Model    string  `json:"model"`
	Cores    int32   `json:"cores"`
	SpeedMHz float64 `json:"speed_mhz"`
}

type RAMInfo struct {
	TotalBytes uint64 `json:"total_bytes"`
}

type DiskInfo struct {
	Device     string `json:"device"`
	Label      string `json:"label"`
	FSType     string `json:"fs_type"`
	TotalBytes uint64 `json:"total_bytes"`
	FreeBytes  uint64 `json:"free_bytes"`
}

type NetworkInfo struct {
	Name         string   `json:"name"`
	HardwareAddr string   `json:"hardware_addr"`
	Addrs        []string `json:"addrs"`
}

type BIOSInfo struct {
	Vendor       string `json:"vendor"`
	Version      string `json:"version"`
	ReleaseDate  string `json:"release_date"`
	SerialNumber string `json:"serial_number,omitempty"`
}

type SoftwareItem struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Publisher   string `json:"publisher"`
	InstalledAt string `json:"installed_at"`
}

type ServiceItem struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"` // "running" | "stopped"
	StartType   string `json:"start_type"`
}

type SecurityInfo struct {
	Antivirus       []AVEntry `json:"antivirus"`
	FirewallEnabled bool      `json:"firewall_enabled"`
}

type AVEntry struct {
	Name     string `json:"name"`
	Enabled  bool   `json:"enabled"`
	UpToDate bool   `json:"up_to_date"`
}

type AuditResponse struct {
	OK      bool   `json:"ok"`
	AuditID string `json:"audit_id"`
}
