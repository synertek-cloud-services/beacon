import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Bindings } from '../index';
import type { Metrics, FileSizeCheck, FileSizeResult, PingCheck, PingResult, ProcessCheck, ProcessResult, ServiceCheck, ServiceResult, WindowsUpdateDriftCheck, WindowsUpdateDriftResult } from './types';
import { sendEmail } from './email';
import { fetchMaintenanceContext, isDeviceSuppressed } from './maintenance';
import { logActivity } from './activityLog';

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Device = typeof schema.devices.$inferSelect;
type PolicyMonitor = typeof schema.policyMonitors.$inferSelect;
type Policy = typeof schema.policies.$inferSelect;
type EffectiveMonitor = PolicyMonitor & { policy: Policy };

// A device counts as "currently online" for the offline monitor's online
// direction if it checked in within this window — deliberately not the
// user-configurable duration (that's sustainedMinutes, applied afterward).
const ONLINE_PRESENCE_GRACE_SECONDS = 300;

// ── Resolve which monitors apply to a device (company wins over global) ───────

type EnabledPolicyMonitorRow = { policies: Policy; policy_monitors: PolicyMonitor };

// The enabled policies+monitors join is identical for every device — callers
// that evaluate many devices in one invocation (the offline cron) should fetch
// this once and reuse it, rather than re-querying per device.
async function fetchEnabledPolicyMonitors(db: Db): Promise<EnabledPolicyMonitorRow[]> {
  return db.select()
    .from(schema.policies)
    .innerJoin(schema.policyMonitors, eq(schema.policyMonitors.policyId, schema.policies.id))
    .where(and(
      eq(schema.policies.enabled, true),
      eq(schema.policyMonitors.enabled, true),
    ));
}

// Whether a policy's targeting (Companies/Devices/Device Groups + OS/Class)
// covers a given device — does NOT check enabled (callers that care already
// filtered for that) or the same-check_type company-override dedup (that's
// a cross-policy concern, only relevant when resolving the full effective
// set, not when re-checking one already-known monitor).
//
// Targeting (migration 0032) is a heterogeneous OR-list across three kinds
// — Companies (policyCompanyIds), individual Devices (policyDeviceIds), and Device
// Groups (deviceGroupIds/policyGroupIds, migration 0031): zero targets
// across all three means unrestricted (matches Datto's own "multiple
// targets = OR logic" documented behavior, generalized from groups-only to
// all three kinds); one or more means the device must satisfy AT LEAST ONE
// of them, of ANY kind (OR, not AND — adding a Company target does not require
// also being in a Group target). Still ANDed with OS/Class, which is a
// separate, unrelated narrowing dimension. All maps are always pre-fetched
// by the caller, never queried here — this function runs inside per-device
// loops on hot paths (every check-in, the 2-minute offline cron over the
// whole fleet).
function deviceMatchesPolicy(
  p: Policy,
  device: Device,
  deviceGroupIds: Set<string>,
  policyGroupIds: Map<string, Set<string>>,
  policyCompanyIds: Map<string, Set<string>>,
  policyDeviceIds: Map<string, Set<string>>,
): boolean {
  const targetOs    = JSON.parse(p.targetOs)    as string[];
  const targetClass = JSON.parse(p.targetClass) as string[];
  const devClass = device.overrideClass ?? device.detectedClass;
  const osOk    = targetOs.length    === 0 || (device.osType ? targetOs.includes(device.osType) : false);
  const classOk = targetClass.length === 0 || (devClass      ? targetClass.includes(devClass)   : false);
  if (!osOk || !classOk) return false;

  const companies   = policyCompanyIds.get(p.id);
  const devices = policyDeviceIds.get(p.id);
  const groups  = policyGroupIds.get(p.id);
  const total = (companies?.size ?? 0) + (devices?.size ?? 0) + (groups?.size ?? 0);
  if (total === 0) return true; // unrestricted — matches every device

  const matchesCompany   = companies?.has(device.companyId) ?? false;
  const matchesDevice = devices?.has(device.id) ?? false;
  const matchesGroup  = groups ? [...groups].some(gid => deviceGroupIds.has(gid)) : false;
  return matchesCompany || matchesDevice || matchesGroup;
}

function matchMonitorsForDevice(
  rows: EnabledPolicyMonitorRow[],
  device: Device,
  deviceGroupIds: Set<string>,
  policyGroupIds: Map<string, Set<string>>,
  policyCompanyIds: Map<string, Set<string>>,
  policyDeviceIds: Map<string, Set<string>>,
): EffectiveMonitor[] {
  const matched = rows.filter(row =>
    deviceMatchesPolicy(row.policies, device, deviceGroupIds, policyGroupIds, policyCompanyIds, policyDeviceIds));

  // A policy's monitors of the same check_type coexist (e.g. two cpu_usage
  // monitors — a 100%/critical trip and a 95%/high early warning — or
  // av_status's three sub-states). Dedup happens per check_type group, not
  // per individual monitor: if any company-scoped policy has monitors of a
  // given check_type for this device, its monitors entirely replace the
  // global ones for that check_type — never merged monitor-by-monitor.
  const byCheckType = new Map<string, EffectiveMonitor[]>();
  for (const row of matched) {
    const pm     = row.policy_monitors;
    const policy = row.policies;
    const group  = byCheckType.get(pm.checkType) ?? [];
    group.push({ ...pm, policy });
    byCheckType.set(pm.checkType, group);
  }

  const effective: EffectiveMonitor[] = [];
  for (const group of byCheckType.values()) {
    const companyMonitors = group.filter(m => m.policy.scope === 'company');
    effective.push(...(companyMonitors.length > 0 ? companyMonitors : group));
  }

  return effective;
}

// ── Device Groups (migration 0031) — both fetched once per invocation and
// reused across every device evaluated in that invocation, same "fetch once,
// don't re-query per device" rule fetchEnabledPolicyMonitors already
// established above. policy_groups/a single device's memberships are both
// tiny queries even at "fetch for the whole fleet" scale (self-hosted, tens
// not thousands of devices/groups).

async function fetchPolicyGroupIds(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(schema.policyGroups);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.policyId)) out.set(r.policyId, new Set());
    out.get(r.policyId)!.add(r.groupId);
  }
  return out;
}

// Exported for worker/src/lib/maintenance.ts, which reuses the same
// device_group_members lookup for Maintenance Policy targeting.
export async function fetchDeviceGroupIds(db: Db, deviceIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (deviceIds.length === 0) return out;
  const rows = await db.select().from(schema.deviceGroupMembers)
    .where(inArray(schema.deviceGroupMembers.deviceId, deviceIds));
  for (const r of rows) {
    if (!out.has(r.deviceId)) out.set(r.deviceId, new Set());
    out.get(r.deviceId)!.add(r.groupId);
  }
  return out;
}

// Policy Companies/Devices targeting (migration 0032) — same "fetch whole table
// once per invocation, never per device" rule as fetchPolicyGroupIds above.
async function fetchPolicyCompanyIds(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(schema.policyCompanies);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.policyId)) out.set(r.policyId, new Set());
    out.get(r.policyId)!.add(r.companyId);
  }
  return out;
}

async function fetchPolicyDeviceIds(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(schema.policyDevices);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.policyId)) out.set(r.policyId, new Set());
    out.get(r.policyId)!.add(r.deviceId);
  }
  return out;
}

// Single-device convenience wrapper for call sites that only ever evaluate
// one device per invocation (check-in, audit) — the offline cron evaluates
// many devices at once and calls fetchEnabledPolicyMonitors/matchMonitorsForDevice
// directly instead, to fetch the join only once per invocation.
export async function resolveEffectiveMonitors(db: Db, device: Device): Promise<EffectiveMonitor[]> {
  const rows = await fetchEnabledPolicyMonitors(db);
  const policyGroupIds = await fetchPolicyGroupIds(db);
  const deviceGroupIds = (await fetchDeviceGroupIds(db, [device.id])).get(device.id) ?? new Set<string>();
  const policyCompanyIds = await fetchPolicyCompanyIds(db);
  const policyDeviceIds = await fetchPolicyDeviceIds(db);
  return matchMonitorsForDevice(rows, device, deviceGroupIds, policyGroupIds, policyCompanyIds, policyDeviceIds);
}

// ── In-band: called from check-in after inventory is updated ─────────────────

export interface CheckinAssignments {
  fileSizeChecks: FileSizeCheck[];
  pingChecks: PingCheck[];
  processChecks: ProcessCheck[];
  serviceChecks: ServiceCheck[];
  windowsUpdateDriftChecks: WindowsUpdateDriftCheck[];
}

export async function evaluateCheckinAlerts(
  DB: D1Database,
  env: Bindings,
  device: Device,
  metrics: Metrics,
  now: number,
): Promise<CheckinAssignments> {
  const db = drizzle(DB, { schema });
  const monitors = await resolveEffectiveMonitors(db, device);
  const fileSizeChecks: FileSizeCheck[] = [];
  const pingChecks: PingCheck[] = [];
  const processChecks: ProcessCheck[] = [];
  const serviceChecks: ServiceCheck[] = [];
  const windowsUpdateDriftChecks: WindowsUpdateDriftCheck[] = [];
  const minuteBucket = Math.floor(now / 60);

  for (const monitor of monitors) {
    if (monitor.checkType === 'offline') continue; // handled by cron
    // Throttle evaluation frequency below the 60s check-in cadence. Stateless
    // by design — bucketing by wall-clock minute avoids needing a "last
    // evaluated" timestamp, which would just reintroduce a write every
    // check-in and defeat the point.
    if (minuteBucket % monitor.checkIntervalMinutes !== 0) continue;

    if (monitor.checkType === 'file_size') {
      // Measured by the agent, not evaluated from metrics — assign the path
      // to check now, evaluate the result it reports on a later check-in.
      const cfg = JSON.parse(monitor.config) as { path: string };
      fileSizeChecks.push({ monitor_id: monitor.id, path: cfg.path });
      continue;
    }

    if (monitor.checkType === 'ping') {
      // Measured by the agent, not evaluated from metrics — assign the
      // target to ping now, evaluate the result it reports on a later check-in.
      const cfg = JSON.parse(monitor.config) as { target: string; packet_count: number };
      pingChecks.push({ monitor_id: monitor.id, target: cfg.target, count: cfg.packet_count });
      continue;
    }

    if (monitor.checkType === 'process') {
      // Measured by the agent, not evaluated from metrics — assign the
      // process name to look up now, evaluate the result it reports on a
      // later check-in.
      const cfg = JSON.parse(monitor.config) as { process_name: string };
      processChecks.push({ monitor_id: monitor.id, process_name: cfg.process_name });
      continue;
    }

    if (monitor.checkType === 'service') {
      // Measured by the agent, not evaluated from metrics — assign the
      // service name to look up now, evaluate the result it reports on a
      // later check-in. Skipped entirely (not even assigned) until the
      // device has been up for boot_delay_minutes, so services still
      // starting up right after boot don't cause false "stopped" alerts.
      const cfg = JSON.parse(monitor.config) as { service_name: string; boot_delay_minutes?: number };
      if (metrics.uptime_seconds < (cfg.boot_delay_minutes ?? 0) * 60) continue;
      serviceChecks.push({ monitor_id: monitor.id, service_name: cfg.service_name });
      continue;
    }

    if (monitor.checkType === 'windows_update_drift') {
      // Measured by the agent (a read-only registry check), not evaluated
      // from metrics — assign now, evaluate the result it reports on a
      // later check-in. Skipped entirely (not even assigned) unless Beacon
      // currently believes it's managing this device -- there's nothing to
      // verify drift against otherwise, same "skip assignment, not
      // evaluation" shape as service's boot_delay_minutes gate above.
      if (!device.windowsUpdateManaged) continue;
      windowsUpdateDriftChecks.push({ monitor_id: monitor.id });
      continue;
    }

    const failed = evaluateCheck(monitor, metrics);
    await processAlertState(db, env, device, monitor, failed, now);
  }

  return { fileSizeChecks, pingChecks, processChecks, serviceChecks, windowsUpdateDriftChecks };
}

// ── File size: results reported by the agent for a prior check-in's assignments

export async function evaluateFileSizeAlerts(
  DB: D1Database,
  env: Bindings,
  device: Device,
  results: FileSizeResult[],
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });

  for (const result of results) {
    const row = await db.select()
      .from(schema.policyMonitors)
      .innerJoin(schema.policies, eq(schema.policies.id, schema.policyMonitors.policyId))
      .where(eq(schema.policyMonitors.id, result.monitor_id))
      .get();
    if (!row || row.policy_monitors.checkType !== 'file_size') continue; // deleted/changed since assignment

    const monitor: EffectiveMonitor = { ...row.policy_monitors, policy: row.policies };
    const cfg = JSON.parse(monitor.config) as { mode: 'below' | 'over'; threshold_mb: number };
    const sizeMb = result.size_bytes / 1048576;
    const failed = result.exists && (cfg.mode === 'over' ? sizeMb > cfg.threshold_mb : sizeMb < cfg.threshold_mb);

    await processAlertState(db, env, device, monitor, failed, now);
  }
}

// ── Ping: results reported by the agent for a prior check-in's assignments ───

export async function evaluatePingAlerts(
  DB: D1Database,
  env: Bindings,
  device: Device,
  results: PingResult[],
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });

  for (const result of results) {
    const row = await db.select()
      .from(schema.policyMonitors)
      .innerJoin(schema.policies, eq(schema.policies.id, schema.policyMonitors.policyId))
      .where(eq(schema.policyMonitors.id, result.monitor_id))
      .get();
    if (!row || row.policy_monitors.checkType !== 'ping') continue; // deleted/changed since assignment

    const monitor: EffectiveMonitor = { ...row.policy_monitors, policy: row.policies };
    const cfg = JSON.parse(monitor.config) as {
      check_unreachable: boolean;
      packet_loss_pct: number | null;
      latency_ms: number | null;
    };

    const unreachable = result.packets_received === 0;
    // Packet-loss only alerts when the target is reachable but lossy —
    // total loss is the unreachable condition's job, not this one's.
    const lossPct = result.packets_sent > 0
      ? (result.packets_sent - result.packets_received) / result.packets_sent * 100
      : 0;

    const failed =
      (cfg.check_unreachable && unreachable) ||
      (cfg.packet_loss_pct !== null && result.packets_received > 0 && lossPct >= cfg.packet_loss_pct) ||
      (cfg.latency_ms !== null && result.packets_received > 0 && result.avg_rtt_ms > cfg.latency_ms);

    await processAlertState(db, env, device, monitor, failed, now);
  }
}

// ── Process: results reported by the agent for a prior check-in's assignments

export async function evaluateProcessAlerts(
  DB: D1Database,
  env: Bindings,
  device: Device,
  results: ProcessResult[],
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });

  for (const result of results) {
    const row = await db.select()
      .from(schema.policyMonitors)
      .innerJoin(schema.policies, eq(schema.policies.id, schema.policyMonitors.policyId))
      .where(eq(schema.policyMonitors.id, result.monitor_id))
      .get();
    if (!row || row.policy_monitors.checkType !== 'process') continue; // deleted/changed since assignment

    const monitor: EffectiveMonitor = { ...row.policy_monitors, policy: row.policies };
    const cfg = JSON.parse(monitor.config) as {
      mode: 'running' | 'stopped' | 'cpu' | 'memory';
      threshold_pct: number | null;
    };

    let failed = false;
    switch (cfg.mode) {
      case 'running': failed = result.running; break;
      case 'stopped': failed = !result.running; break;
      case 'cpu':      failed = result.running && cfg.threshold_pct !== null && result.cpu_percent >= cfg.threshold_pct; break;
      case 'memory':   failed = result.running && cfg.threshold_pct !== null && result.mem_percent >= cfg.threshold_pct; break;
    }

    await processAlertState(db, env, device, monitor, failed, now);
  }
}

// ── Service: results reported by the agent for a prior check-in's assignments

export async function evaluateServiceAlerts(
  DB: D1Database,
  env: Bindings,
  device: Device,
  results: ServiceResult[],
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });

  for (const result of results) {
    const row = await db.select()
      .from(schema.policyMonitors)
      .innerJoin(schema.policies, eq(schema.policies.id, schema.policyMonitors.policyId))
      .where(eq(schema.policyMonitors.id, result.monitor_id))
      .get();
    if (!row || row.policy_monitors.checkType !== 'service') continue; // deleted/changed since assignment

    const monitor: EffectiveMonitor = { ...row.policy_monitors, policy: row.policies };
    const cfg = JSON.parse(monitor.config) as {
      mode: 'running' | 'stopped' | 'cpu' | 'memory';
      threshold_pct: number | null;
    };

    let failed = false;
    switch (cfg.mode) {
      case 'running': failed = result.running; break;
      case 'stopped': failed = !result.running; break;
      case 'cpu':      failed = result.running && cfg.threshold_pct !== null && result.cpu_percent >= cfg.threshold_pct; break;
      case 'memory':   failed = result.running && cfg.threshold_pct !== null && result.mem_percent >= cfg.threshold_pct; break;
    }

    await processAlertState(db, env, device, monitor, failed, now);
  }
}

// ── Windows Update drift: results reported by the agent for a prior
// check-in's assignments ─────────────────────────────────────────────────

export async function evaluateWindowsUpdateDriftAlerts(
  DB: D1Database,
  env: Bindings,
  device: Device,
  results: WindowsUpdateDriftResult[],
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });

  for (const result of results) {
    const row = await db.select()
      .from(schema.policyMonitors)
      .innerJoin(schema.policies, eq(schema.policies.id, schema.policyMonitors.policyId))
      .where(eq(schema.policyMonitors.id, result.monitor_id))
      .get();
    if (!row || row.policy_monitors.checkType !== 'windows_update_drift') continue; // deleted/changed since assignment
    // A result can arrive for a check assigned earlier in the same request
    // that just processed this device's manage_windows_update revert
    // completion -- the in-memory `device` fetched at the top of checkin.ts
    // predates that update, so assignment (evaluateCheckinAlerts, above)
    // can't see it either. Re-checking here, not just at assignment time,
    // is what actually matters: a stale in-flight result must never reopen
    // tracking for a device Beacon no longer manages. Confirmed live against
    // local wrangler dev -- without this guard, a stale result set
    // condition_first_seen on an alert resolveWindowsUpdateDriftAlerts had
    // already unconditionally closed moments earlier.
    if (!device.windowsUpdateManaged) continue;

    const monitor: EffectiveMonitor = { ...row.policy_monitors, policy: row.policies };
    // A read error is inconclusive, not evidence of an override -- only a
    // successful read showing the wrong value counts as drift. Beacon's own
    // management only ever asserts NoAutoUpdate=1; au_options is left
    // untouched by managePS, so it's irrelevant to what counts as drift.
    const failed = !result.error && result.no_auto_update !== 1;

    await processAlertState(db, env, device, monitor, failed, now);
  }
}

// ── Software: evaluated from the audit-diff flow, not check-in ───────────────
// Event-driven, not state-driven — a software install/uninstall/version-change
// is only ever observed on the exact audit where the diff detected it, never
// re-observed on a later one. No sustained-window concept applies; matching
// monitors always have sustainedMinutes=0 (see the processAlertState fix
// above) so they fire on this single detection instead of needing a repeat.

function matchesPattern(name: string, pattern: string): boolean {
  if (!pattern.includes('%')) return name.toLowerCase() === pattern.toLowerCase();
  const escaped = pattern
    .split('%')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

interface SoftwareChange {
  changeType: string;
  itemName: string;
  field: string | null;
}

export async function evaluateSoftwareAlerts(
  DB: D1Database,
  env: Bindings,
  device: Device,
  changes: SoftwareChange[],
  now: number,
): Promise<void> {
  if (changes.length === 0) return; // nothing changed this audit — nothing to check

  const db = drizzle(DB, { schema });
  const monitors = (await resolveEffectiveMonitors(db, device))
    .filter(m => m.checkType === 'software');
  if (monitors.length === 0) return;

  for (const monitor of monitors) {
    const cfg = JSON.parse(monitor.config) as {
      name_pattern: string;
      mode: 'installed' | 'uninstalled' | 'version_changed';
    };
    const wantedType = cfg.mode === 'installed' ? 'added' : cfg.mode === 'uninstalled' ? 'removed' : 'changed';

    const matched = changes.some(ch =>
      ch.changeType === wantedType &&
      (wantedType !== 'changed' || ch.field === 'version') &&
      matchesPattern(ch.itemName, cfg.name_pattern),
    );

    // Only called on a match — auto_resolve is always false for this type
    // (Datto's spec: manual resolve only), so there's nothing to clear on a
    // non-match; calling with failed=false would just be a pointless read.
    if (matched) {
      await processAlertState(db, env, device, monitor, true, now);
    }
  }
}

// ── Out-of-band: called from the cron scheduled handler ──────────────────────

export async function evaluateOfflineAlerts(
  DB: D1Database,
  env: Bindings,
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });

  const allDevices = await db.select()
    .from(schema.devices)
    .where(eq(schema.devices.status, 'approved'));

  // Fetched once for the whole cron tick — this join is identical for every
  // device, so re-querying it per device (as before) was a redundant D1
  // round trip per device every 2 minutes. Same rule for the two Device
  // Group maps below — fetched once for ALL devices, not per device.
  const policyMonitorRows = await fetchEnabledPolicyMonitors(db);
  const policyGroupIds = await fetchPolicyGroupIds(db);
  const deviceGroupIds = await fetchDeviceGroupIds(db, allDevices.map(d => d.id));
  const policyCompanyIds = await fetchPolicyCompanyIds(db);
  const policyDeviceIds = await fetchPolicyDeviceIds(db);
  const maintCtx = await fetchMaintenanceContext(db, allDevices.map(d => d.id), now);

  for (const device of allDevices) {
    if (isDeviceSuppressed(device, maintCtx)) continue;

    const monitors = matchMonitorsForDevice(
      policyMonitorRows, device, deviceGroupIds.get(device.id) ?? new Set(), policyGroupIds,
      policyCompanyIds, policyDeviceIds);
    const offlineMonitors = monitors.filter(m => m.checkType === 'offline');

    for (const monitor of offlineMonitors) {
      const cfg = JSON.parse(monitor.config) as { direction?: 'offline' | 'online'; offline_after_seconds: number };
      const direction = cfg.direction ?? 'offline';

      let failed: boolean;
      if (direction === 'online') {
        // "Currently checking in" presence check — how long it must stay true
        // before alerting is handled by the existing sustainedMinutes debounce
        // in processAlertState, same as every other check type.
        failed = device.lastSeen !== null && (now - device.lastSeen) < ONLINE_PRESENCE_GRACE_SECONDS;
      } else {
        failed = device.lastSeen === null || device.lastSeen < now - cfg.offline_after_seconds;
      }

      await processAlertState(db, env, device, monitor, failed, now);
    }
  }
}

// ── Shared logic ─────────────────────────────────────────────────────────────

const GB = 1073741824;

function diskBreaches(d: NonNullable<Metrics['disks']>[number], thresholdType: string, thresholdValue: number): boolean {
  switch (thresholdType) {
    case 'gb_free':      return d.free_bytes < thresholdValue * GB;
    case 'gb_used':      return (d.total_bytes - d.free_bytes) > thresholdValue * GB;
    case 'percent_used': return d.total_bytes > 0 && ((d.total_bytes - d.free_bytes) / d.total_bytes) * 100 >= thresholdValue;
    default:              return false;
  }
}

function evaluateCheck(monitor: PolicyMonitor, metrics: Metrics): boolean {
  const cfg = JSON.parse(monitor.config) as Record<string, unknown>;
  switch (monitor.checkType) {
    case 'disk_space': {
      const disks = metrics.disks;
      if (!disks || disks.length === 0) return false;
      const drive          = (cfg.drive as string) ?? 'any';
      const thresholdType  = (cfg.threshold_type as string) ?? 'gb_free';
      const thresholdValue = cfg.threshold_value as number;
      const minDiskGb      = cfg.min_disk_gb as number | null | undefined;

      let candidates = disks;
      if (minDiskGb) candidates = candidates.filter(d => d.total_bytes >= minDiskGb * GB);
      if (drive !== 'any') {
        const target = drive.trim().toLowerCase();
        candidates = candidates.filter(d =>
          d.device.trim().toLowerCase() === target || d.label.trim().toLowerCase() === target);
      }
      return candidates.some(d => diskBreaches(d, thresholdType, thresholdValue));
    }
    case 'cpu_usage':
      return metrics.cpu_percent !== undefined && metrics.cpu_percent >= (cfg.percent_max as number);
    case 'memory_usage':
      return metrics.memory_percent !== undefined && metrics.memory_percent >= (cfg.percent_max as number);
    case 'av_status': {
      const status = metrics.av_status;
      if (!status) return false;
      return status === (cfg.av_state as string);
    }
    default:
      return false;
  }
}

async function processAlertState(
  db: Db,
  env: Bindings,
  device: Device,
  monitor: EffectiveMonitor,
  failed: boolean,
  now: number,
): Promise<void> {
  const existing = await db.select()
    .from(schema.alertState)
    .where(and(
      eq(schema.alertState.deviceId, device.id),
      eq(schema.alertState.policyMonitorId, monitor.id),
    ))
    .get();

  if (!existing) {
    // A monitor that's never failed doesn't need a row yet — nothing reads
    // alert_state by existence, only by is_alerting/alerted_at once a real
    // breach occurs (see admin/alerts.ts). Avoids a write on every healthy
    // device's first-ever check-in for every monitor.
    if (!failed) return;
    // sustainedMinutes === 0 means no debounce is wanted — fire on this very
    // first detection rather than waiting for a second consecutive failure.
    // For continuously-sampled monitors (60s check-ins) the old always-seed
    // behavior was invisible (a confirming sample arrives a minute later
    // anyway), but for one-shot/edge-triggered checks like software installs
    // — evaluated once per audit, sometimes 24h apart — a transition never
    // repeats, so waiting for a "second" failure meant it could never fire.
    const fireImmediately = monitor.sustainedMinutes === 0;
    const alertStateId = crypto.randomUUID();
    await db.insert(schema.alertState).values({
      id:                 alertStateId,
      deviceId:           device.id,
      policyMonitorId:    monitor.id,
      conditionFirstSeen: now,
      isAlerting:         fireImmediately,
      alertedAt:          fireImmediately ? now : null,
      alertPriority:      fireImmediately ? monitor.alertPriority : null,
      updatedAt:          now,
    });
    if (fireImmediately) {
      if (monitor.notifyWebhook) await fireWebhooks(db, device, monitor, 'alert.triggered', now, alertStateId, monitor.alertPriority);
      if (monitor.notifyEmail)   await sendAlertEmails(env, device, monitor, 'alert.triggered', now, alertStateId, monitor.alertPriority, now);
      await logActivity(db, {
        actorType: 'system', category: 'Alert', action: `Alert triggered: ${monitor.checkType}`,
        entityType: 'device', entityId: device.id, companyId: device.companyId,
        method: 'CRON', details: { policy: monitor.policy.name, priority: monitor.alertPriority, alertStateId },
      });
    }
    return;
  }

  if (failed) {
    const firstSeen      = existing.conditionFirstSeen ?? now;
    const sustainedSecs  = monitor.sustainedMinutes * 60;
    const sustained      = (now - firstSeen) >= sustainedSecs;
    const shouldFire     = sustained && !existing.isAlerting;

    const newConditionFirstSeen = existing.conditionFirstSeen ?? now;
    const newIsAlerting         = shouldFire || existing.isAlerting;
    const newAlertedAt          = shouldFire ? now : existing.alertedAt;
    const newAlertPriority      = shouldFire ? monitor.alertPriority : existing.alertPriority;

    // Only worth rate-limiting a transition that's actually about to notify
    // someone -- a monitor with both channels off has nothing to rate-limit.
    const notifiable = monitor.notifyWebhook || monitor.notifyEmail;
    const rl = shouldFire && notifiable ? computeRateLimit(existing, now) : null;

    const changed =
      newConditionFirstSeen !== existing.conditionFirstSeen ||
      newIsAlerting          !== existing.isAlerting ||
      newAlertedAt           !== existing.alertedAt ||
      newAlertPriority        !== existing.alertPriority ||
      rl !== null;

    if (changed) {
      await db.update(schema.alertState)
        .set({
          conditionFirstSeen: newConditionFirstSeen,
          isAlerting:         newIsAlerting,
          alertedAt:          newAlertedAt,
          alertPriority:      newAlertPriority,
          updatedAt:          now,
          ...(rl ? {
            transitionWindowStartedAt: rl.transitionWindowStartedAt,
            transitionCount:           rl.transitionCount,
            notificationsMutedUntil:   rl.notificationsMutedUntil,
          } : {}),
        })
        .where(eq(schema.alertState.id, existing.id));
    }

    if (shouldFire) {
      if (!rl || !rl.suppressNotification) {
        if (monitor.notifyWebhook) await fireWebhooks(db, device, monitor, 'alert.triggered', now, existing.id, monitor.alertPriority);
        if (monitor.notifyEmail)   await sendAlertEmails(env, device, monitor, 'alert.triggered', now, existing.id, monitor.alertPriority, now);
        await logActivity(db, {
          actorType: 'system', category: 'Alert', action: `Alert triggered: ${monitor.checkType}`,
          entityType: 'device', entityId: device.id, companyId: device.companyId,
          method: 'CRON', details: { policy: monitor.policy.name, priority: monitor.alertPriority, alertStateId: existing.id },
        });
      } else if (rl.isBreakerTrip) {
        await fireRateLimitNotification(db, env, device, monitor, existing.id, rl.notificationsMutedUntil!, now);
      }
      // else: already muted from an earlier trip within this window -- silent.
    }
  } else {
    const wasAlerting     = existing.isAlerting;
    const shouldAutoResolve =
      wasAlerting &&
      monitor.autoResolve &&
      existing.alertedAt !== null &&
      (now - existing.alertedAt) >= monitor.autoResolveAfterMinutes * 60;

    const newIsAlerting = shouldAutoResolve ? false : existing.isAlerting;
    const newResolvedAt = shouldAutoResolve ? now   : existing.resolvedAt;

    const notifiable = monitor.notifyWebhook || monitor.notifyEmail;
    const rl = wasAlerting && shouldAutoResolve && notifiable ? computeRateLimit(existing, now) : null;

    const changed =
      existing.conditionFirstSeen !== null ||
      newIsAlerting                !== existing.isAlerting ||
      newResolvedAt                !== existing.resolvedAt ||
      rl !== null;

    if (changed) {
      await db.update(schema.alertState)
        .set({
          conditionFirstSeen: null,
          isAlerting:         newIsAlerting,
          resolvedAt:         newResolvedAt,
          updatedAt:          now,
          ...(rl ? {
            transitionWindowStartedAt: rl.transitionWindowStartedAt,
            transitionCount:           rl.transitionCount,
            notificationsMutedUntil:   rl.notificationsMutedUntil,
          } : {}),
        })
        .where(eq(schema.alertState.id, existing.id));
    }

    if (wasAlerting && shouldAutoResolve) {
      // Fallback only matters for rows that fired before migration 0048
      // shipped and never got a snapshot -- every row created after ships
      // with alertPriority already set by the time it can resolve.
      const priority = existing.alertPriority ?? monitor.alertPriority;
      if (!rl || !rl.suppressNotification) {
        if (monitor.notifyWebhook) await fireWebhooks(db, device, monitor, 'alert.resolved', now, existing.id, priority);
        if (monitor.notifyEmail)   await sendAlertEmails(env, device, monitor, 'alert.resolved', now, existing.id, priority, existing.alertedAt);
        await logActivity(db, {
          actorType: 'system', category: 'Alert', action: `Alert auto-resolved: ${monitor.checkType}`,
          entityType: 'device', entityId: device.id, companyId: device.companyId,
          method: 'CRON', details: { policy: monitor.policy.name, priority, alertStateId: existing.id },
        });
      } else if (rl.isBreakerTrip) {
        await fireRateLimitNotification(db, env, device, monitor, existing.id, rl.notificationsMutedUntil!, now);
      }
    }
  }
}

// Manual resolve (dashboard "Resolve" button, POST /v1/admin/alerts/:id/resolve)
// -- mirrors the auto-resolve notification behavior above (same event,
// same per-monitor notifyWebhook/notifyEmail gating), but triggered by an
// explicit technician action instead of a passing evaluation. The bulk
// paths below (reconcileOrphanedAlerts/resolveAllOpenAlerts) deliberately
// do NOT call this -- those fire on policy/monitor config edits (narrowed
// targeting, deletion), not on the real-world condition actually clearing,
// and notifying on those would read as a ticketing system's alert closing
// for a reason unrelated to the monitored problem going away.
export async function manuallyResolveAlert(
  DB: D1Database,
  env: Bindings,
  alertStateId: string,
  now: number,
): Promise<boolean> {
  const db = drizzle(DB, { schema });

  const row = await db.select()
    .from(schema.alertState)
    .innerJoin(schema.policyMonitors, eq(schema.policyMonitors.id, schema.alertState.policyMonitorId))
    .innerJoin(schema.policies, eq(schema.policies.id, schema.policyMonitors.policyId))
    .innerJoin(schema.devices, eq(schema.devices.id, schema.alertState.deviceId))
    .where(eq(schema.alertState.id, alertStateId))
    .get();

  if (!row) return false;

  const monitor: EffectiveMonitor = { ...row.policy_monitors, policy: row.policies };
  const wasAlerting = row.alert_state.isAlerting;

  await db.update(schema.alertState)
    .set({
      isAlerting:         false,
      conditionFirstSeen: null,
      resolvedAt:         now,
      updatedAt:          now,
      // A technician manually resolving is a deliberate action, not part of
      // an automatic flapping cycle -- reset the rate-limit window/counter
      // so a fresh recurrence is treated as new, not counted against
      // whatever tripped it before. Manual resolve is itself never
      // rate-limited (see the comment above this function).
      transitionWindowStartedAt: null,
      transitionCount:           0,
      notificationsMutedUntil:   null,
    })
    .where(eq(schema.alertState.id, alertStateId));

  if (wasAlerting) {
    const priority = row.alert_state.alertPriority ?? monitor.alertPriority;
    if (monitor.notifyWebhook) await fireWebhooks(db, row.devices, monitor, 'alert.resolved', now, alertStateId, priority);
    if (monitor.notifyEmail)   await sendAlertEmails(env, row.devices, monitor, 'alert.resolved', now, alertStateId, priority, row.alert_state.alertedAt);
  }

  return true;
}

// Global, not scoped to the triggering device's company — the hoster's own
// team reads alerts, not the client company being monitored (see the
// notification_emails/users.receivesAlerts recipient model below, same
// reasoning).
async function fireWebhooks(
  db: Db,
  device: Device,
  monitor: EffectiveMonitor,
  event: 'alert.triggered' | 'alert.resolved' | 'alert.rate_limited',
  now: number,
  alertStateId: string,
  priority: string,
  // Extra fields merged into the JSON body -- currently just muted_until for
  // the rate_limited event; kept generic rather than adding a 3rd fixed
  // parameter so a future event's own extra field doesn't need another
  // signature change.
  extra?: Record<string, unknown>,
): Promise<void> {
  const webhooks = await db.select()
    .from(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.enabled, true));

  if (!webhooks.length) return;

  const body = JSON.stringify({
    event,
    timestamp:  now,
    alert_id:   alertStateId,
    device_id:  device.id,
    company_id:  device.companyId,
    hostname:   device.hostname,
    check_type: monitor.checkType,
    monitor_id: monitor.id,
    policy_id:  monitor.policyId,
    priority,
    config:     JSON.parse(monitor.config),
    ...extra,
  });

  await Promise.allSettled(
    webhooks.map(wh =>
      fetch(wh.url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    )
  );
}

// Mirrors dashboard/src/pages/GlobalPoliciesPage.vue's own checkLabel() --
// worker and dashboard are separate deployables with no shared package, so
// this is a small intentional duplication (matching this codebase's existing
// per-deployable duplication convention), not a refactor opportunity.
function checkTypeLabel(checkType: string): string {
  switch (checkType) {
    case 'disk_space':   return 'Disk Space';
    case 'offline':      return 'Online Status';
    case 'cpu_usage':    return 'CPU';
    case 'memory_usage': return 'Memory';
    case 'av_status':    return 'Antivirus';
    case 'file_size':    return 'File/Folder Size';
    case 'ping':         return 'Ping';
    case 'process':      return 'Process';
    case 'service':      return 'Service';
    case 'software':     return 'Software';
    case 'windows_update_drift': return 'Windows Update Drift';
    default:             return checkType;
  }
}

function titleCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function formatUtc(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

// Recipients are two unioned sources, both global/hoster-level: Beacon
// accounts opted in via users.receivesAlerts, plus standalone addresses in
// notification_emails with no Beacon account at all (a shared mailbox, a
// ticketing system's inbound address, etc.). Extracted out of sendAlertEmails
// once a second real consumer (sendRateLimitEmail, below) needed the exact
// same resolution -- matches this codebase's established "extract on the
// second real consumer" convention (e.g. fetchCompanyVariables).
async function resolveAlertRecipients(db: Db, companyId: string): Promise<{ emails: string[]; companyName: string }> {
  const [userRows, standaloneRows, company] = await Promise.all([
    db.select({ email: schema.users.email })
      .from(schema.users)
      .where(and(eq(schema.users.receivesAlerts, true), eq(schema.users.status, 'active'))),
    db.select({ email: schema.notificationEmails.email })
      .from(schema.notificationEmails)
      .where(eq(schema.notificationEmails.enabled, true)),
    db.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, companyId)).get(),
  ]);
  return {
    emails: [...new Set([...userRows.map(r => r.email), ...standaloneRows.map(r => r.email)])],
    companyName: company?.name ?? companyId,
  };
}

// Issue #88's PSA-ingestion contract: a stable subject prefix across the
// whole open->resolved lifecycle (only a trailing [Open]/[Resolved] tag
// differs), a labeled/structured field block (not prose alone) in both html
// and text, alert_state.id exposed as an explicit Alert ID field (it was
// already stable across the lifecycle -- every transition UPDATEs the same
// row -- just never surfaced as a labeled field before), and X-Beacon-*
// headers for programmatic PSA routing. Mirrors fireWebhooks' existing
// labeled-field precedent (alert_id/device_id/company_id/etc.) immediately
// above, just rendered for a human+PSA reader instead of a raw JSON POST.
async function sendAlertEmails(
  env: Bindings,
  device: Device,
  monitor: EffectiveMonitor,
  event: 'alert.triggered' | 'alert.resolved',
  now: number,
  alertStateId: string,
  priority: string,
  // The real open time -- NOT always equal to `now`. `now` only doubles as
  // the open time at the two trigger call sites; at both resolve call sites
  // `now` is the resolve time, and the real open time (existing.alertedAt /
  // row.alert_state.alertedAt) has to be threaded through explicitly.
  alertedAt: number | null,
): Promise<void> {
  const db = drizzle(env.DB, { schema });
  const { emails, companyName } = await resolveAlertRecipients(db, device.companyId);
  if (!emails.length) return;

  const isResolved = event === 'alert.resolved';
  const stateLabel = isResolved ? 'Resolved' : 'Open';
  const verb = isResolved ? 'resolved' : 'triggered';
  const deviceName = device.hostname ?? device.id;
  const checkLabel = checkTypeLabel(monitor.checkType);
  const priorityLabel = titleCase(priority);
  const link = `${env.ALLOWED_ORIGIN ?? ''}/#/global/alerts/${alertStateId}`;

  // Stable prefix across both messages for this same alertStateId -- only
  // the trailing state tag differs, so a PSA's subject-matching correlation
  // logic can key off the shared portion.
  const subject = `[Beacon] ${companyName} - ${deviceName} - ${checkLabel} (${priorityLabel}) [${stateLabel}]`;

  // Same labeled field set, same order, in both formats and both states --
  // only State/Resolved At differ in content between an open and a resolved
  // message for the same alert.
  type Field = [string, string];
  const fields: Field[] = [
    ['Alert ID', alertStateId],
    ['Company', companyName],
    ['Company ID', device.companyId],
    ['Device', deviceName],
    ['Device ID', device.id],
    ['Check Type', monitor.checkType],
    ['Priority', priorityLabel],
    ['State', stateLabel],
    ['Opened At', alertedAt !== null ? formatUtc(alertedAt) : '—'],
  ];
  if (isResolved) fields.push(['Resolved At', formatUtc(now)]);
  fields.push(['Dashboard', link]);

  const intro = `Beacon alert: ${checkLabel} check on ${deviceName} (${companyName}) is now ${stateLabel.toUpperCase()}.`;

  const html = `<p>${intro}</p><table cellpadding="0" cellspacing="0" style="border-collapse:collapse">${fields
    .map(([label, value]) => {
      const cell = label === 'Dashboard' ? `<a href="${link}">${link}</a>` : escapeHtml(value);
      return `<tr><td style="padding:2px 12px 2px 0;color:#666">${label}</td><td style="padding:2px 0">${cell}</td></tr>`;
    })
    .join('')}</table>`;

  const labelWidth = Math.max(...fields.map(([label]) => label.length)) + 2;
  const text = `${intro}\n\n${fields.map(([label, value]) => `${(label + ':').padEnd(labelWidth)}${value}`).join('\n')}`;

  await sendEmail(env, emails, subject, html, text, {
    'X-Beacon-Alert-Id': alertStateId,
    'X-Beacon-Device-Id': device.id,
    'X-Beacon-Company-Id': device.companyId,
    'X-Beacon-Event': verb,
    'X-Beacon-Priority': priority,
    'X-Beacon-Schema-Version': '1',
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Rate limiting / circuit breaker for flapping monitors (issue #169) ───────
//
// Scoped to the alert_state row (one per device+monitor pair), not
// policy_monitors -- policy_monitors is shared across every device a policy
// targets (no deviceId column on it at all), so muting there would silently
// kill notifications for every OTHER device on the same policy too, not just
// the one that's actually flapping. One fixed window+threshold, not
// configurable -- matches this codebase's "one fixed thing, not a builder"
// convention (e.g. the reboot marker's fixed 1-hour snooze).
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const RATE_LIMIT_THRESHOLD = 10; // transitions allowed per window before muting

type AlertStateRow = typeof schema.alertState.$inferSelect;

interface RateLimitDecision {
  suppressNotification: boolean;
  // True only on the exact transition that crosses the threshold -- the one
  // moment a one-time-per-trip meta-notification should fire instead of the
  // normal alert.triggered/resolved one. False for every other suppressed
  // transition while already muted.
  isBreakerTrip: boolean;
  transitionWindowStartedAt: number;
  transitionCount: number;
  notificationsMutedUntil: number | null;
}

// Pure -- only called when a transition is actually about to notify someone
// (shouldFire/shouldAutoResolve already true, notifyWebhook||notifyEmail
// already true). Frozen (counter/window untouched) while an existing mute is
// still active, so the window boundary alone governs when muting clears --
// no separate "unmute" bookkeeping needed, mirrors fastPollUntil/
// maintenanceEndsAt's own self-expiring-on-read convention.
function computeRateLimit(existing: AlertStateRow, now: number): RateLimitDecision {
  if (existing.notificationsMutedUntil !== null && existing.notificationsMutedUntil > now) {
    return {
      suppressNotification: true,
      isBreakerTrip: false,
      transitionWindowStartedAt: existing.transitionWindowStartedAt ?? now,
      transitionCount: existing.transitionCount,
      notificationsMutedUntil: existing.notificationsMutedUntil,
    };
  }

  const windowExpired = existing.transitionWindowStartedAt === null ||
    (now - existing.transitionWindowStartedAt) >= RATE_LIMIT_WINDOW_SECONDS;
  const transitionWindowStartedAt = windowExpired ? now : existing.transitionWindowStartedAt!;
  const transitionCount = windowExpired ? 1 : existing.transitionCount + 1;

  if (transitionCount > RATE_LIMIT_THRESHOLD) {
    return {
      suppressNotification: true,
      isBreakerTrip: true,
      transitionWindowStartedAt,
      transitionCount,
      notificationsMutedUntil: transitionWindowStartedAt + RATE_LIMIT_WINDOW_SECONDS,
    };
  }

  return {
    suppressNotification: false,
    isBreakerTrip: false,
    transitionWindowStartedAt,
    transitionCount,
    notificationsMutedUntil: null, // clears a stale expired mute, if any
  };
}

// Static, unrelated to the alert.triggered/resolved template above -- this
// isn't reporting a device condition, it's a system/operational message
// about the notification channel itself, so it deliberately doesn't reuse
// sendAlertEmails' Open/Resolved subject/body contract from issue #88.
async function sendRateLimitEmail(
  env: Bindings,
  device: Device,
  monitor: EffectiveMonitor,
  alertStateId: string,
  mutedUntil: number,
  now: number,
): Promise<void> {
  const db = drizzle(env.DB, { schema });
  const { emails, companyName } = await resolveAlertRecipients(db, device.companyId);
  if (!emails.length) return;

  const deviceName = device.hostname ?? device.id;
  const checkLabel = checkTypeLabel(monitor.checkType);
  const link = `${env.ALLOWED_ORIGIN ?? ''}/#/global/alerts/${alertStateId}`;
  const subject = `[Beacon] ${companyName} - ${deviceName} - ${checkLabel} notifications rate-limited`;

  const body =
    `The ${checkLabel} check on ${deviceName} (${companyName}) has fired more than ` +
    `${RATE_LIMIT_THRESHOLD} times in the last ${RATE_LIMIT_WINDOW_SECONDS / 60} minutes. ` +
    `Beacon is still tracking this alert and it remains visible on the dashboard -- only ` +
    `further webhook/email notifications for it are paused until ${formatUtc(mutedUntil)}, ` +
    `to avoid flooding this channel while it keeps flapping.\n\n${link}`;

  await sendEmail(env, emails, subject, `<p>${escapeHtml(body).replace(/\n\n/g, '</p><p>')}</p>`, body, {
    'X-Beacon-Alert-Id': alertStateId,
    'X-Beacon-Device-Id': device.id,
    'X-Beacon-Company-Id': device.companyId,
    'X-Beacon-Event': 'rate_limited',
    'X-Beacon-Schema-Version': '1',
  });
}

async function fireRateLimitNotification(
  db: Db,
  env: Bindings,
  device: Device,
  monitor: EffectiveMonitor,
  alertStateId: string,
  mutedUntil: number,
  now: number,
): Promise<void> {
  if (monitor.notifyWebhook) {
    await fireWebhooks(db, device, monitor, 'alert.rate_limited', now, alertStateId, monitor.alertPriority, { muted_until: mutedUntil });
  }
  if (monitor.notifyEmail) {
    await sendRateLimitEmail(env, device, monitor, alertStateId, mutedUntil, now);
  }
  await logActivity(db, {
    actorType: 'system', category: 'Alert', action: `Alert notifications rate-limited: ${monitor.checkType}`,
    entityType: 'device', entityId: device.id, companyId: device.companyId,
    method: 'CRON', details: { policy: monitor.policy.name, alertStateId, mutedUntil },
  });
}

// ── Called from policy/monitor admin routes after an edit ────────────────────
//
// A monitor only ever gets re-evaluated when something calls processAlertState
// for it — check-in, the offline cron, or an audit. If a policy/monitor edit
// narrows targeting or disables something out from under a device that
// currently has it alerting, nothing will ever evaluate that pair again, so
// auto-resolve (which itself requires a fresh passing evaluation) can never
// fire — the alert would otherwise stay open forever. These reconcile
// existing open alert_state rows against the just-saved policy/monitor state.

// After a policy or monitor PATCH: re-check each currently-open alert for the
// given monitor ids against current (post-edit) targeting/enabled state, and
// resolve the ones that no longer apply. Does not check the same-check_type
// company-override dedup rule — that's a cross-policy effect triggered by a
// *different* policy being created, out of scope for a single edit's reconcile.
export async function reconcileOrphanedAlerts(
  DB: D1Database,
  monitorIds: string[],
  now: number,
): Promise<void> {
  if (monitorIds.length === 0) return;
  const db = drizzle(DB, { schema });

  const rows = await db.select()
    .from(schema.alertState)
    .innerJoin(schema.policyMonitors, eq(schema.policyMonitors.id, schema.alertState.policyMonitorId))
    .innerJoin(schema.policies, eq(schema.policies.id, schema.policyMonitors.policyId))
    .innerJoin(schema.devices, eq(schema.devices.id, schema.alertState.deviceId))
    .where(and(
      inArray(schema.alertState.policyMonitorId, monitorIds),
      eq(schema.alertState.isAlerting, true),
    ));

  const policyGroupIds = await fetchPolicyGroupIds(db);
  const deviceGroupIds = await fetchDeviceGroupIds(db, rows.map(r => r.devices.id));
  const policyCompanyIds = await fetchPolicyCompanyIds(db);
  const policyDeviceIds = await fetchPolicyDeviceIds(db);

  for (const row of rows) {
    const stillApplies =
      row.policy_monitors.enabled &&
      row.policies.enabled &&
      deviceMatchesPolicy(row.policies, row.devices, deviceGroupIds.get(row.devices.id) ?? new Set(), policyGroupIds,
        policyCompanyIds, policyDeviceIds);
    if (stillApplies) continue;

    await db.update(schema.alertState)
      .set({ isAlerting: false, resolvedAt: now, conditionFirstSeen: null, updatedAt: now })
      .where(eq(schema.alertState.id, row.alert_state.id));
  }
}

// Before a policy/monitor DELETE: unconditionally resolve every open alert
// for the monitor ids about to be removed — after deletion nothing could ever
// match again, so there's no targeting check to run, just close them out.
export async function resolveAllOpenAlerts(
  DB: D1Database,
  monitorIds: string[],
  now: number,
): Promise<void> {
  if (monitorIds.length === 0) return;
  const db = drizzle(DB, { schema });

  await db.update(schema.alertState)
    .set({ isAlerting: false, resolvedAt: now, conditionFirstSeen: null, updatedAt: now })
    .where(and(
      inArray(schema.alertState.policyMonitorId, monitorIds),
      eq(schema.alertState.isAlerting, true),
    ));
}

// Called from checkin.ts's manage_windows_update revert-completion branch.
// Unconditional, unlike processAlertState(failed=false) -- that path only
// clears isAlerting when the monitor's own auto_resolve/auto_resolve_after_minutes
// grace period has elapsed, which governs a different case (still-failing-
// but-within-grace-period). Once Beacon stops managing a device it has
// fallen out of this monitor's applicability entirely -- the same framing
// reconcileOrphanedAlerts itself uses (a device no longer matching what a
// monitor even applies to), not "administrative" (coverage loss can be
// system-driven via syncWindowsUpdateManagement's own retargeting, not a
// technician action). Same deliberate no-notification precedent as
// reconcileOrphanedAlerts/resolveAllOpenAlerts above -- a coverage change,
// not a real-time condition transition.
export async function resolveWindowsUpdateDriftAlerts(DB: D1Database, deviceId: string, now: number): Promise<void> {
  const db = drizzle(DB, { schema });
  const rows = await db.select({ id: schema.alertState.id })
    .from(schema.alertState)
    .innerJoin(schema.policyMonitors, eq(schema.policyMonitors.id, schema.alertState.policyMonitorId))
    .where(and(
      eq(schema.alertState.deviceId, deviceId),
      eq(schema.policyMonitors.checkType, 'windows_update_drift'),
      eq(schema.alertState.isAlerting, true),
    ));
  for (const row of rows) {
    await db.update(schema.alertState)
      .set({ isAlerting: false, resolvedAt: now, conditionFirstSeen: null, updatedAt: now })
      .where(eq(schema.alertState.id, row.id));
  }
}
