import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { fetchDeviceGroupIds } from './alerts';
import { logActivity } from './activityLog';

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Device = typeof schema.devices.$inferSelect;
type PatchPolicy = typeof schema.patchPolicies.$inferSelect;

// ── Recurrence evaluation ──────────────────────────────────────────────────
// Verbatim duplicate of lib/maintenance.ts's isMaintenanceWindowActive and
// its helpers, retyped against patchPolicies -- not shared, same
// per-policy-type mirroring convention every other policy type in this
// codebase already follows (see maintenancePolicySites' own comment).

const WEEK_MINUTES = 7 * 1440;
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function wallClockParts(unixSeconds: number, timeZone: string): { weekdayIdx: number; minutesSinceMidnight: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(unixSeconds * 1000));
  const weekday = parts.find(p => p.type === 'weekday')!.value;
  const hour   = Number(parts.find(p => p.type === 'hour')!.value) % 24;
  const minute = Number(parts.find(p => p.type === 'minute')!.value);
  return { weekdayIdx: WEEKDAY_INDEX[weekday], minutesSinceMidnight: hour * 60 + minute };
}

function inCyclicRange(x: number, start: number, end: number): boolean {
  return (x >= start && x < end) || (x + WEEK_MINUTES >= start && x + WEEK_MINUTES < end);
}

export function isPatchWindowActive(policy: PatchPolicy, hostTimezone: string, now: number): boolean {
  if (policy.recurrenceType === 'one_time') {
    if (policy.oneTimeStartAt == null || policy.oneTimeDurationMinutes == null) return false;
    const end = policy.oneTimeStartAt + policy.oneTimeDurationMinutes * 60;
    return now >= policy.oneTimeStartAt && now < end;
  }

  if (!policy.weeklyDays || policy.weeklyStartMinute == null || policy.weeklyDurationMinutes == null) return false;
  const days = JSON.parse(policy.weeklyDays) as number[];
  if (days.length === 0) return false;

  const { weekdayIdx, minutesSinceMidnight } = wallClockParts(now, hostTimezone);
  const nowWeekMinutes = weekdayIdx * 1440 + minutesSinceMidnight;

  return days.some(d => {
    const windowStart = d * 1440 + policy.weeklyStartMinute!;
    const windowEnd   = windowStart + policy.weeklyDurationMinutes!;
    return inCyclicRange(nowWeekMinutes, windowStart, windowEnd);
  });
}

// windowDurationSeconds: the policy's own configured duration, used by
// dispatchDuePatchPolicies to avoid re-dispatching within one continuous
// active occurrence (see that function's own comment for why this is
// simpler than computing an exact window-start timestamp).
function windowDurationSeconds(policy: PatchPolicy): number {
  const minutes = policy.recurrenceType === 'one_time' ? policy.oneTimeDurationMinutes : policy.weeklyDurationMinutes;
  return (minutes ?? 0) * 60;
}

// ── Severity ranking ────────────────────────────────────────────────────────
// severity is free text throughout (WUA/MSRC-sourced, not a DB enum) -- this
// is the one place an order is imposed on it, matching the vocabulary the
// dashboard's own severity badges already use.
const SEVERITY_RANK: Record<string, number> = { Critical: 4, Important: 3, Moderate: 2, Low: 1 };

function meetsSeverityThreshold(severity: string, minSeverity: string): boolean {
  return (SEVERITY_RANK[severity] ?? 0) >= (SEVERITY_RANK[minSeverity] ?? 0);
}

// ── Targeting (exact mirror of lib/maintenance.ts's Sites/Devices/Groups
// OR-list machinery, retyped -- duplicated, not shared) ────────────────────

async function fetchEnabledPatchPolicies(db: Db): Promise<PatchPolicy[]> {
  return db.select().from(schema.patchPolicies).where(eq(schema.patchPolicies.enabled, true));
}

async function fetchPatchPolicySiteIds(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(schema.patchPolicySites);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.policyId)) out.set(r.policyId, new Set());
    out.get(r.policyId)!.add(r.companyId);
  }
  return out;
}

async function fetchPatchPolicyDeviceIds(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(schema.patchPolicyDevices);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.policyId)) out.set(r.policyId, new Set());
    out.get(r.policyId)!.add(r.deviceId);
  }
  return out;
}

async function fetchPatchPolicyGroupIds(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(schema.patchPolicyGroups);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.policyId)) out.set(r.policyId, new Set());
    out.get(r.policyId)!.add(r.groupId);
  }
  return out;
}

function deviceMatchesPatchPolicy(
  p: PatchPolicy,
  device: Device,
  deviceGroupIds: Set<string>,
  policyGroupIds: Map<string, Set<string>>,
  policySiteIds: Map<string, Set<string>>,
  policyDeviceIds: Map<string, Set<string>>,
): boolean {
  const sites   = policySiteIds.get(p.id);
  const devices = policyDeviceIds.get(p.id);
  const groups  = policyGroupIds.get(p.id);
  const total = (sites?.size ?? 0) + (devices?.size ?? 0) + (groups?.size ?? 0);
  if (total === 0) return true; // unrestricted — matches every device

  const matchesSite   = sites?.has(device.companyId) ?? false;
  const matchesDevice = devices?.has(device.id) ?? false;
  const matchesGroup  = groups ? [...groups].some(gid => deviceGroupIds.has(gid)) : false;
  return matchesSite || matchesDevice || matchesGroup;
}

// ── Fleet patch scan (exact two-phase pattern GET /v1/admin/patches already
// uses: scan every approved device's latest audit, group by update_id, then
// overlay patch_approvals) -- shared here since both auto-approval and
// dispatch eligibility need the same "who has what pending" answer. ────────

interface AuditPatchItem {
  update_id?: string;
  title: string;
  kb_article_ids: string[];
  severity: string;
  categories: string[];
}

export interface FleetPatchState {
  updateId: string;
  severity: string;
  deviceIds: string[]; // devices with this update currently pending
  status: 'pending' | 'approved' | 'ignored';
}

export async function scanFleetPatches(db: Db, devices: { id: string }[]): Promise<Map<string, FleetPatchState>> {
  const byUpdateId = new Map<string, FleetPatchState>();

  for (const device of devices) {
    const audit = await db.select({ patches: schema.deviceAudits.patches })
      .from(schema.deviceAudits)
      .where(and(eq(schema.deviceAudits.deviceId, device.id), isNotNull(schema.deviceAudits.patches)))
      .orderBy(desc(schema.deviceAudits.createdAt))
      .limit(1)
      .get();
    if (!audit?.patches) continue;

    let items: AuditPatchItem[];
    try {
      items = JSON.parse(audit.patches);
    } catch {
      continue;
    }

    for (const item of items) {
      if (!item.update_id) continue; // pre-upgrade agent -- needs a rescan, same as GET /v1/admin/patches
      let entry = byUpdateId.get(item.update_id);
      if (!entry) {
        entry = { updateId: item.update_id, severity: item.severity, deviceIds: [], status: 'pending' };
        byUpdateId.set(item.update_id, entry);
      }
      entry.deviceIds.push(device.id);
    }
  }

  if (byUpdateId.size > 0) {
    const approvals = await db.select().from(schema.patchApprovals).all();
    for (const a of approvals) {
      const entry = byUpdateId.get(a.updateId);
      if (entry) entry.status = a.status as 'approved' | 'ignored';
    }
  }

  return byUpdateId;
}

// ── Auto-approval ────────────────────────────────────────────────────────
// Fleet-wide, same as manual approval (patch_approvals has no per-device
// concept) -- a policy's min_severity threshold, met by a patch anywhere in
// the fleet, approves it globally, reusing the exact upsert shape
// PATCH /v1/admin/patches/:updateId already uses. The policy's own
// targeting only controls which devices receive the resulting *install*
// (see dispatchDuePatchPolicies), not which patches get approved.
export async function autoApprovePatches(db: Db, now: number): Promise<void> {
  const policies = await fetchEnabledPatchPolicies(db);
  const rules = policies.filter(p => p.minSeverity != null);
  if (rules.length === 0) return;

  const devices = await db.select({ id: schema.devices.id })
    .from(schema.devices)
    .where(eq(schema.devices.status, 'approved'))
    .all();
  const fleet = await scanFleetPatches(db, devices);

  for (const patch of fleet.values()) {
    if (patch.status !== 'pending') continue;
    const meetsAnyRule = rules.some(p => meetsSeverityThreshold(patch.severity, p.minSeverity!));
    if (!meetsAnyRule) continue;

    // Check-then-insert, not an ON CONFLICT upsert -- matches the
    // established convention elsewhere in this codebase (e.g. the device
    // custom-field-value upsert). patch.status === 'pending' above already
    // means scanFleetPatches found no existing row for this updateId as of
    // this invocation, but re-check right before inserting as a narrow
    // defense against a race with a concurrent manual approval.
    const existing = await db.select({ updateId: schema.patchApprovals.updateId })
      .from(schema.patchApprovals).where(eq(schema.patchApprovals.updateId, patch.updateId)).get();
    if (existing) continue;

    await db.insert(schema.patchApprovals).values({
      updateId: patch.updateId,
      status: 'approved',
      title: '', // best-effort snapshot; GET /v1/admin/patches always re-derives title live from the fleet scan anyway
      kbArticleIds: '[]',
      severity: patch.severity,
      updatedAt: now,
    });
    // Layer-2 call -- runs from the scheduled() cron, never a user-authenticated
    // HTTP route. Kept distinct from dispatchDuePatchPolicies' own call below --
    // "a patch was auto-approved" and "a policy dispatched installs" are two
    // separate facts an operator would want told apart.
    await logActivity(db, {
      actorType: 'system', category: 'Patch', action: 'Auto-approved patch',
      entityType: 'patch', entityId: patch.updateId, method: 'CRON',
      details: { severity: patch.severity },
    });
  }
}

// ── Scheduled dispatch ──────────────────────────────────────────────────────
// The active-cron-dispatch half Maintenance Policy's passive suppression
// gate doesn't need -- closer to Jobs' dispatchDueScheduledJobs shape. Jobs'
// own NOT EXISTS (SELECT 1 FROM commands WHERE job_id = j.id) idiom is
// one-shot-only and doesn't generalize to a *recurring* weekly window --
// see the re-dispatch guard below instead.
export async function dispatchDuePatchPolicies(DB: D1Database, now: number): Promise<void> {
  const db = drizzle(DB, { schema });

  await autoApprovePatches(db, now);

  const policies = await fetchEnabledPatchPolicies(db);
  if (policies.length === 0) return;

  const row = await db.select({ timezone: schema.hostSettings.timezone })
    .from(schema.hostSettings).where(eq(schema.hostSettings.id, 1)).get();
  const hostTimezone = row?.timezone ?? 'UTC';

  // A continuous active stretch can't outlast its own configured duration,
  // so "last dispatch was more than this window's duration ago" is enough
  // to guarantee exactly one dispatch per occurrence without computing an
  // exact window-start timestamp -- re-arms correctly once the window goes
  // inactive and later recurs.
  const due = policies.filter(p => {
    if (!isPatchWindowActive(p, hostTimezone, now)) return false;
    if (p.lastDispatchedAt == null) return true;
    return now > p.lastDispatchedAt + windowDurationSeconds(p);
  });
  if (due.length === 0) return;

  const [policySiteIds, policyDeviceIds, policyGroupIds, devices] = await Promise.all([
    fetchPatchPolicySiteIds(db),
    fetchPatchPolicyDeviceIds(db),
    fetchPatchPolicyGroupIds(db),
    db.select().from(schema.devices).where(eq(schema.devices.status, 'approved')).all(),
  ]);
  const deviceGroupIds = await fetchDeviceGroupIds(db, devices.map(d => d.id));
  const fleet = await scanFleetPatches(db, devices);

  for (const policy of due) {
    const targeted = devices.filter(d =>
      deviceMatchesPatchPolicy(policy, d, deviceGroupIds.get(d.id) ?? new Set(), policyGroupIds, policySiteIds, policyDeviceIds));

    let dispatchedCount = 0;
    for (const device of targeted) {
      const eligible = [...fleet.values()]
        .filter(patch => patch.status === 'approved' && patch.deviceIds.includes(device.id))
        .map(patch => patch.updateId);
      if (eligible.length === 0) continue;

      await db.insert(schema.commands).values({
        id: crypto.randomUUID(),
        deviceId: device.id,
        companyId: device.companyId,
        type: 'install_patches',
        payload: JSON.stringify({ update_ids: eligible, auto_reboot: policy.autoReboot }),
        status: 'queued',
        createdAt: now,
      });
      dispatchedCount++;
    }

    await db.update(schema.patchPolicies).set({ lastDispatchedAt: now }).where(eq(schema.patchPolicies.id, policy.id));

    // Layer-2 call, only when this policy actually dispatched to ≥1 device --
    // a policy whose window is active but has nothing eligible right now
    // isn't a real, log-worthy event.
    if (dispatchedCount > 0) {
      await logActivity(db, {
        actorType: 'system', category: 'Patch Policy', action: 'Dispatched patch installs',
        entityType: 'patchPolicy', entityId: policy.id, method: 'CRON',
        details: { deviceCount: dispatchedCount },
      });
    }
  }
}

// ── Admin CRUD support ──────────────────────────────────────────────────────

export async function copyPatchPolicyTargets(DB: D1Database, sourcePolicyId: string, newPolicyId: string, now: number): Promise<void> {
  const db = drizzle(DB, { schema });
  const [sites, devices, groups] = await Promise.all([
    db.select().from(schema.patchPolicySites).where(eq(schema.patchPolicySites.policyId, sourcePolicyId)),
    db.select().from(schema.patchPolicyDevices).where(eq(schema.patchPolicyDevices.policyId, sourcePolicyId)),
    db.select().from(schema.patchPolicyGroups).where(eq(schema.patchPolicyGroups.policyId, sourcePolicyId)),
  ]);
  await Promise.all([
    ...sites.map(s => db.insert(schema.patchPolicySites).values({ policyId: newPolicyId, companyId: s.companyId, createdAt: now })),
    ...devices.map(d => db.insert(schema.patchPolicyDevices).values({ policyId: newPolicyId, deviceId: d.deviceId, createdAt: now })),
    ...groups.map(g => db.insert(schema.patchPolicyGroups).values({ policyId: newPolicyId, groupId: g.groupId, createdAt: now })),
  ]);
}
