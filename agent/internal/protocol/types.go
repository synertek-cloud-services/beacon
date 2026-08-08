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
	DeviceID                         string                     `json:"device_id"`
	TenantID                         string                     `json:"tenant_id"`
	Timestamp                        int64                      `json:"timestamp"`
	AgentVersion                     string                     `json:"agent_version"`
	Metrics                          Metrics                    `json:"metrics"`
	PendingCommandResults            []CommandResult            `json:"pending_command_results"`
	PendingFileSizeResults           []FileSizeResult           `json:"pending_file_size_results,omitempty"`
	PendingPingResults               []PingResult               `json:"pending_ping_results,omitempty"`
	PendingProcessResults            []ProcessResult            `json:"pending_process_results,omitempty"`
	PendingServiceResults            []ServiceResult            `json:"pending_service_results,omitempty"`
	PendingWindowsUpdateDriftResults []WindowsUpdateDriftResult `json:"pending_windows_update_drift_results,omitempty"`
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
	Commands                 []Command                 `json:"commands,omitempty"`
	FileSizeChecks           []FileSizeCheck           `json:"file_size_checks,omitempty"`
	PingChecks               []PingCheck               `json:"ping_checks,omitempty"`
	ProcessChecks            []ProcessCheck            `json:"process_checks,omitempty"`
	ServiceChecks            []ServiceCheck            `json:"service_checks,omitempty"`
	WindowsUpdateDriftChecks []WindowsUpdateDriftCheck `json:"windows_update_drift_checks,omitempty"`
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

// WindowsUpdateDriftCheck asks the agent to read (never write) Windows' own
// Automatic Updates registry policy for a windows_update_drift monitor,
// mirroring auconfig.Apply's readSnippet but with no Set-ItemProperty/
// Remove-ItemProperty anywhere. Reports back via WindowsUpdateDriftResult.
type WindowsUpdateDriftCheck struct {
	MonitorID string `json:"monitor_id"`
}

// WindowsUpdateDriftResult reports the outcome of a previously issued
// WindowsUpdateDriftCheck. Pointer fields distinguish "the registry value
// wasn't present" from "not reported" -- Error is set instead on a read
// failure, which the worker treats as inconclusive, never as evidence of
// drift.
type WindowsUpdateDriftResult struct {
	MonitorID    string `json:"monitor_id"`
	NoAutoUpdate *int   `json:"no_auto_update,omitempty"`
	AUOptions    *int   `json:"au_options,omitempty"`
	Error        string `json:"error,omitempty"`
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
	// Deliberately no omitempty -- encoding/json's omitempty treats any
	// zero-length slice as empty regardless of nil-ness, which collapsed a
	// real, successfully-scanned "zero pending patches" result (a non-nil
	// empty slice from collectPatches' success path) into the exact same
	// omitted-field wire shape as "never collected" (nil, from a collection
	// error or a non-Windows device) -- both landed as `patches: null` on
	// the dashboard, indistinguishable from an actually-up-to-date device.
	// Root-caused live: WUA search on a real production device found and
	// correctly filtered its one pending item (a Defender Definition
	// Update) down to zero real patches with no error at all, yet the
	// stored audit still showed null. Without omitempty, a nil slice still
	// serializes as explicit `null` (collection semantics unchanged) while
	// a non-nil empty slice now serializes as `[]` (a real answer).
	Patches []PatchItem `json:"patches"`
	// Whether this device has the Hyper-V role/feature installed (a
	// virtualization *host*, not a guest -- see HardwareInfo.Virtualization
	// for the opposite check). Nil (omitted) on non-Windows or a collection
	// failure, distinct from a confirmed false. Windows-only, feeds Patch
	// Policy's automatic Hyper-V-host exclusion.
	HypervisorHost *bool `json:"hypervisor_host,omitempty"`
}

type HardwareInfo struct {
	CPU              []CPUInfo     `json:"cpu"`
	RAM              RAMInfo       `json:"ram"`
	Disks            []DiskInfo    `json:"disks"`
	Network          []NetworkInfo `json:"network"`
	BIOS             *BIOSInfo     `json:"bios,omitempty"`
	LastLoggedInUser string        `json:"last_logged_in_user,omitempty"`
	// Architecture is runtime.GOARCH — trivially known at compile time, no
	// platform-specific collection needed.
	Architecture    string      `json:"architecture,omitempty"`
	System          *SystemInfo `json:"system,omitempty"`
	DisplayAdapters []string    `json:"display_adapters,omitempty"`
	// Windows-only concepts — no honest Linux/macOS equivalent, so these stay
	// empty (omitted) on those platforms rather than a faked value.
	Domain                  string `json:"domain,omitempty"`
	WindowsDisplayVersion   string `json:"windows_display_version,omitempty"`
	WindowsInstallationType string `json:"windows_installation_type,omitempty"`
	// Virtualization platform, when detected (e.g. "WSL2", "Hyper-V", "VMware",
	// "VirtualBox", "KVM/QEMU", "Xen"). Empty on bare metal or when undetectable —
	// deliberately not a boolean, since which platform matters (WSL specifically
	// explains why System/BIOS below are otherwise empty: WSL2 doesn't expose
	// DMI/SMBIOS tables the way a full VM does).
	Virtualization string `json:"virtualization,omitempty"`
}

type CPUInfo struct {
	Model    string  `json:"model"`
	Cores    int32   `json:"cores"`
	SpeedMHz float64 `json:"speed_mhz"`
}

type RAMInfo struct {
	TotalBytes uint64 `json:"total_bytes"`
	// InstalledBytes is the raw physical DIMM capacity, distinct from
	// TotalBytes (which is gopsutil's OS-visible/usable figure — can be
	// slightly lower due to firmware/iGPU-reserved memory). Omitted when the
	// platform-specific collector can't read it (e.g. non-root on Linux).
	InstalledBytes uint64 `json:"installed_bytes,omitempty"`
}

// SystemInfo covers chassis-level identity: who made the machine and what
// it's called, plus motherboard identity where that's a meaningful concept
// (not on macOS — Macs are unibody, there's no separate board to report).
type SystemInfo struct {
	Manufacturer      string `json:"manufacturer,omitempty"`
	Model             string `json:"model,omitempty"`
	MotherboardVendor string `json:"motherboard_vendor,omitempty"`
	MotherboardModel  string `json:"motherboard_model,omitempty"`
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

// PatchItem is a pending/missing Windows Update, as reported by
// audit.collectPatches — Windows-only, scan+report only (no install state;
// approval state lives fleet-wide in the worker's patch_approvals table,
// keyed by UpdateID, not on the agent side).
type PatchItem struct {
	// UpdateID is WUA's own stable identity GUID (IUpdate.Identity.UpdateID)
	// -- the real key for fleet-wide approval decisions. Empty on older
	// agents that predate this field; the worker must treat that case as
	// "needs a rescan," not a broken/missing patch.
	UpdateID     string   `json:"update_id,omitempty"`
	Title        string   `json:"title"`
	KBArticleIDs []string `json:"kb_article_ids"`
	Severity     string   `json:"severity"` // Critical|Important|Moderate|Low|Unspecified
	Categories   []string `json:"categories"`
	SizeBytes    uint64   `json:"size_bytes,omitempty"`
	IsDownloaded bool     `json:"is_downloaded"`
	Type         string   `json:"type"` // "software"|"driver"
}

type AuditResponse struct {
	OK      bool   `json:"ok"`
	AuditID string `json:"audit_id"`
}
