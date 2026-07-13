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
  tenant_id: string;
  device_credential: string;
  status: 'pending' | 'approved';
}

// ── Check-in ──────────────────────────────────────────────────────────────────

export interface CheckInRequest {
  device_id: string;
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
