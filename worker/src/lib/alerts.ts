import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Metrics, FileSizeCheck, FileSizeResult, PingCheck, PingResult, ProcessCheck, ProcessResult, ServiceCheck, ServiceResult } from './types';

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

// Whether a policy's scope/OS/class targeting covers a given device — does
// NOT check enabled (callers that care already filtered for that) or the
// same-check_type company-override dedup (that's a cross-policy concern,
// only relevant when resolving the full effective set, not when re-checking
// one already-known monitor).
function deviceMatchesPolicy(p: Policy, device: Device): boolean {
  if (p.scope === 'company' && p.companyId !== device.tenantId) return false;
  const targetOs    = JSON.parse(p.targetOs)    as string[];
  const targetClass = JSON.parse(p.targetClass) as string[];
  const devClass = device.overrideClass ?? device.detectedClass;
  const osOk    = targetOs.length    === 0 || (device.osType ? targetOs.includes(device.osType) : false);
  const classOk = targetClass.length === 0 || (devClass      ? targetClass.includes(devClass)   : false);
  return osOk && classOk;
}

function matchMonitorsForDevice(rows: EnabledPolicyMonitorRow[], device: Device): EffectiveMonitor[] {
  const matched = rows.filter(row => deviceMatchesPolicy(row.policies, device));

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

// Single-device convenience wrapper for call sites that only ever evaluate
// one device per invocation (check-in, audit) — the offline cron evaluates
// many devices at once and calls fetchEnabledPolicyMonitors/matchMonitorsForDevice
// directly instead, to fetch the join only once per invocation.
export async function resolveEffectiveMonitors(db: Db, device: Device): Promise<EffectiveMonitor[]> {
  const rows = await fetchEnabledPolicyMonitors(db);
  return matchMonitorsForDevice(rows, device);
}

// ── In-band: called from check-in after inventory is updated ─────────────────

export interface CheckinAssignments {
  fileSizeChecks: FileSizeCheck[];
  pingChecks: PingCheck[];
  processChecks: ProcessCheck[];
  serviceChecks: ServiceCheck[];
}

export async function evaluateCheckinAlerts(
  DB: D1Database,
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

    const failed = evaluateCheck(monitor, metrics);
    await processAlertState(db, device, monitor, failed, now);
  }

  return { fileSizeChecks, pingChecks, processChecks, serviceChecks };
}

// ── File size: results reported by the agent for a prior check-in's assignments

export async function evaluateFileSizeAlerts(
  DB: D1Database,
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

    await processAlertState(db, device, monitor, failed, now);
  }
}

// ── Ping: results reported by the agent for a prior check-in's assignments ───

export async function evaluatePingAlerts(
  DB: D1Database,
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

    await processAlertState(db, device, monitor, failed, now);
  }
}

// ── Process: results reported by the agent for a prior check-in's assignments

export async function evaluateProcessAlerts(
  DB: D1Database,
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

    await processAlertState(db, device, monitor, failed, now);
  }
}

// ── Service: results reported by the agent for a prior check-in's assignments

export async function evaluateServiceAlerts(
  DB: D1Database,
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

    await processAlertState(db, device, monitor, failed, now);
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
      await processAlertState(db, device, monitor, true, now);
    }
  }
}

// ── Out-of-band: called from the cron scheduled handler ──────────────────────

export async function evaluateOfflineAlerts(
  DB: D1Database,
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });

  const allDevices = await db.select()
    .from(schema.devices)
    .where(eq(schema.devices.status, 'approved'));

  // Fetched once for the whole cron tick — this join is identical for every
  // device, so re-querying it per device (as before) was a redundant D1
  // round trip per device every 2 minutes.
  const policyMonitorRows = await fetchEnabledPolicyMonitors(db);

  for (const device of allDevices) {
    if (device.maintenanceEndsAt != null && device.maintenanceEndsAt > now) continue;

    const monitors = matchMonitorsForDevice(policyMonitorRows, device);
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

      await processAlertState(db, device, monitor, failed, now);
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
    await db.insert(schema.alertState).values({
      id:                 crypto.randomUUID(),
      deviceId:           device.id,
      policyMonitorId:    monitor.id,
      conditionFirstSeen: now,
      isAlerting:         fireImmediately,
      alertedAt:          fireImmediately ? now : null,
      updatedAt:          now,
    });
    if (fireImmediately) {
      await fireWebhooks(db, device, monitor, 'alert.triggered', now);
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

    const changed =
      newConditionFirstSeen !== existing.conditionFirstSeen ||
      newIsAlerting          !== existing.isAlerting ||
      newAlertedAt           !== existing.alertedAt;

    if (changed) {
      await db.update(schema.alertState)
        .set({
          conditionFirstSeen: newConditionFirstSeen,
          isAlerting:         newIsAlerting,
          alertedAt:          newAlertedAt,
          updatedAt:          now,
        })
        .where(eq(schema.alertState.id, existing.id));
    }

    if (shouldFire) {
      await fireWebhooks(db, device, monitor, 'alert.triggered', now);
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

    const changed =
      existing.conditionFirstSeen !== null ||
      newIsAlerting                !== existing.isAlerting ||
      newResolvedAt                !== existing.resolvedAt;

    if (changed) {
      await db.update(schema.alertState)
        .set({
          conditionFirstSeen: null,
          isAlerting:         newIsAlerting,
          resolvedAt:         newResolvedAt,
          updatedAt:          now,
        })
        .where(eq(schema.alertState.id, existing.id));
    }

    if (wasAlerting && shouldAutoResolve) {
      await fireWebhooks(db, device, monitor, 'alert.resolved', now);
    }
  }
}

async function fireWebhooks(
  db: Db,
  device: Device,
  monitor: EffectiveMonitor,
  event: 'alert.triggered' | 'alert.resolved',
  now: number,
): Promise<void> {
  const webhooks = await db.select()
    .from(schema.webhookEndpoints)
    .where(and(
      eq(schema.webhookEndpoints.tenantId, device.tenantId),
      eq(schema.webhookEndpoints.enabled, true),
    ));

  if (!webhooks.length) return;

  const body = JSON.stringify({
    event,
    timestamp:  now,
    device_id:  device.id,
    tenant_id:  device.tenantId,
    hostname:   device.hostname,
    check_type: monitor.checkType,
    monitor_id: monitor.id,
    policy_id:  monitor.policyId,
    config:     JSON.parse(monitor.config),
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

  for (const row of rows) {
    const stillApplies =
      row.policy_monitors.enabled &&
      row.policies.enabled &&
      deviceMatchesPolicy(row.policies, row.devices);
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
