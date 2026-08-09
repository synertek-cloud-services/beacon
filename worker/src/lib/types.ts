// Protocol types shared between worker routes. These mirror the Go structs
// in agent/internal/protocol/types.go — keep them in sync when either changes.

export type DeviceClass = 'server' | 'workstation' | 'laptop';
export type AgentType = 'standard' | 'discovery_probe';
export type DeviceStatus = 'pending' | 'approved' | 'revoked';

// ── Enrollment ────────────────────────────────────────────────────────────────

export interface EnrollRequest {
  hostname: string;
  os_type: string;
  os_version: string;
  agent_version: string;
  detected_class: DeviceClass;
}

export interface EnrollResponse {
  device_id: string;
  // Wire field name intentionally stays `tenant_id` — this mirrors the Go
  // agent's protocol struct (agent/internal/protocol/types.go), which was
  // deliberately not touched by the Company rename. Renaming this broke
  // enroll/check-in/audit for every already-deployed agent in production
  // (mismatched wire field vs. the agent's own `tenant_id` JSON tag) until
  // reverted here. Internal DB/schema naming stays `companyId` throughout;
  // only this wire contract is pinned to the old name.
  tenant_id: string;
  device_credential: string;
  status: 'pending' | 'approved';
}

// ── Check-in ──────────────────────────────────────────────────────────────────

export interface CheckInRequest {
  device_id: string;
  // See EnrollResponse's tenant_id comment above — same wire-compat pin.
  tenant_id: string;
  timestamp: number;
  agent_version: string;
  metrics: Metrics;
  // Results of commands issued in previous check-in responses, piggybacked here
  // to avoid a separate request type. Empty array on first check-in.
  pending_command_results: CommandResult[];
  // Measurements taken in response to a previous check-in's file_size_checks.
  pending_file_size_results?: FileSizeResult[];
  // Measurements taken in response to a previous check-in's ping_checks.
  pending_ping_results?: PingResult[];
  // Measurements taken in response to a previous check-in's process_checks.
  pending_process_results?: ProcessResult[];
  // Measurements taken in response to a previous check-in's service_checks.
  pending_service_results?: ServiceResult[];
  // Measurements taken in response to a previous check-in's
  // windows_update_drift_checks.
  pending_windows_update_drift_results?: WindowsUpdateDriftResult[];
}

// Phase 1 inventory payload — deliberately minimal. Extended in later phases
// by adding fields to this struct without breaking old agents.
export interface Metrics {
  hostname: string;
  os_type: string;
  os_version: string;
  uptime_seconds: number;
  disk_free_bytes: number;
  disks?: DiskInfo[];
  detected_class: DeviceClass;
  cpu_percent?: number;
  memory_percent?: number;
  // "running_up_to_date" | "running_not_up_to_date" | "not_running" | "not_detected" | "" (unsupported)
  av_status?: string;
  av_product?: string;
}

export interface DiskInfo {
  device: string;
  label: string;
  fs_type: string;
  total_bytes: number;
  free_bytes: number;
}

export interface CheckInResponse {
  // Omitted (not present in JSON) when empty — old agents must tolerate absence.
  commands?: Command[];
  // Paths the agent should measure and report back via pending_file_size_results
  // on its next check-in.
  file_size_checks?: FileSizeCheck[];
  // Targets the agent should ping and report back via pending_ping_results
  // on its next check-in.
  ping_checks?: PingCheck[];
  // Process names the agent should look up and report back via
  // pending_process_results on its next check-in.
  process_checks?: ProcessCheck[];
  // Windows service names the agent should look up and report back via
  // pending_service_results on its next check-in.
  service_checks?: ServiceCheck[];
  // Windows Update drift verification the agent should perform (read-only
  // registry check, no writes) and report back via
  // pending_windows_update_drift_results on its next check-in. Only ever
  // assigned to a device with windowsUpdateManaged=true (see
  // evaluateCheckinAlerts) — there's nothing to verify otherwise.
  windows_update_drift_checks?: WindowsUpdateDriftCheck[];
}

// ── File size checks ────────────────────────────────────────────────────────

export interface FileSizeCheck {
  monitor_id: string;
  path: string;
}

export interface FileSizeResult {
  monitor_id: string;
  exists: boolean;
  size_bytes: number;
}

// ── Ping checks ──────────────────────────────────────────────────────────────

export interface PingCheck {
  monitor_id: string;
  target: string;
  count: number;
}

export interface PingResult {
  monitor_id: string;
  packets_sent: number;
  packets_received: number;
  avg_rtt_ms: number;
}

// ── Process checks ───────────────────────────────────────────────────────────

export interface ProcessCheck {
  monitor_id: string;
  process_name: string;
}

export interface ProcessResult {
  monitor_id: string;
  running: boolean;
  cpu_percent: number;
  mem_percent: number;
}

// ── Service checks ───────────────────────────────────────────────────────────

export interface ServiceCheck {
  monitor_id: string;
  service_name: string;
}

export interface ServiceResult {
  monitor_id: string;
  running: boolean;
  cpu_percent: number;
  mem_percent: number;
}

// ── Windows Update drift checks ──────────────────────────────────────────────
// Read-only verification of Windows' own Automatic Updates registry policy
// (agent/internal/auconfig.Read) — never writes anything, distinct from the
// manage_windows_update command that actually sets/reverts it. See
// CLAUDE.md's Patch Management section (issue #79).

export interface WindowsUpdateDriftCheck {
  monitor_id: string;
}

export interface WindowsUpdateDriftResult {
  monitor_id: string;
  // Absent (not just 0/false) when the registry value itself is unset --
  // distinct from a read error, which sets `error` instead and is never
  // treated as evidence of drift (an inconclusive measurement, not a
  // confirmed override).
  no_auto_update?: number;
  au_options?: number;
  error?: string;
}

// ── Commands ──────────────────────────────────────────────────────────────────

export interface Command {
  command_id: string;
  // Agent executes known types and silently ignores unknown ones — forward compat.
  type: string;
  payload: unknown;
}

export interface CommandResult {
  command_id: string;
  status: 'completed' | 'failed';
  stdout: string;
  stderr: string;
  exit_code: number;
}
