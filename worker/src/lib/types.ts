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
}

// Phase 1 inventory payload — deliberately minimal. Extended in later phases
// by adding fields to this struct without breaking old agents.
export interface Metrics {
  hostname: string;
  os_type: string;
  os_version: string;
  uptime_seconds: number;
  disk_free_bytes: number;
  detected_class: DeviceClass;
  cpu_percent?: number;
  memory_percent?: number;
}

export interface CheckInResponse {
  // Omitted (not present in JSON) when empty — old agents must tolerate absence.
  commands?: Command[];
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
