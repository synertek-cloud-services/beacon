import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { fetchDeviceGroupIds } from './alerts';

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Device = typeof schema.devices.$inferSelect;
type MaintenancePolicy = typeof schema.maintenancePolicies.$inferSelect;

// ── Recurrence evaluation ──────────────────────────────────────────────────
//
// "Is a maintenance window active right now" for a single policy, given the
// host-wide timezone (see hostSettings). One-time is plain UTC range math --
// the timezone was already baked in once at creation time via the dashboard's
// conversion helper. Weekly is wall-clock, always re-interpreted against the
// CURRENT host timezone on every evaluation (matches Datto's own "one
// account-wide Time Zone applies to schedules" behavior).

const WEEK_MINUTES = 7 * 1440;
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Wall-clock weekday (0=Sun..6=Sat) + minutes-since-midnight for a UTC
// instant, in an arbitrary IANA timezone. Intl.DateTimeFormat's timeZone
// option is ICU-backed (same as workerd/browsers) and correctly DST-aware --
// verified against both the US spring-forward skip and fall-back repeat
// before relying on it here. No new date/timezone library needed.
function wallClockParts(unixSeconds: number, timeZone: string): { weekdayIdx: number; minutesSinceMidnight: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(unixSeconds * 1000));
  const weekday = parts.find(p => p.type === 'weekday')!.value;
  // Defensive: hour12:false has historically returned "24" for midnight on
  // some engines; modern V8/workerd returns "00", but normalize either way.
  const hour   = Number(parts.find(p => p.type === 'hour')!.value) % 24;
  const minute = Number(parts.find(p => p.type === 'minute')!.value);
  return { weekdayIdx: WEEKDAY_INDEX[weekday], minutesSinceMidnight: hour * 60 + minute };
}

// x in [start, end) OR x+WEEK in [start, end) -- the second branch catches a
// window whose [start, start+duration) range crosses the Sat->Sun week
// boundary (e.g. Saturday 23:00 + 3h duration -> Sunday 02:00): "now" near
// the start of the week (small x) needs to also be tested one week later.
function inCyclicRange(x: number, start: number, end: number): boolean {
  return (x >= start && x < end) || (x + WEEK_MINUTES >= start && x + WEEK_MINUTES < end);
}

// Pure -- does NOT check policy.enabled (same convention as
// deviceMatchesPolicy in lib/alerts.ts: callers fetch only enabled policies
// already, via fetchEnabledMaintenancePolicies below).
export function isMaintenanceWindowActive(policy: MaintenancePolicy, hostTimezone: string, now: number): boolean {
  if (policy.recurrenceType === 'one_time') {
    if (policy.oneTimeStartAt == null || policy.oneTimeDurationMinutes == null) return false;
    const end = policy.oneTimeStartAt + policy.oneTimeDurationMinutes * 60;
    return now >= policy.oneTimeStartAt && now < end;
  }

  // weekly
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

// ── Targeting (mirrors the Sites/Devices/Groups OR-list machinery in
// lib/alerts.ts's deviceMatchesPolicy, minus the OS/Class gate -- Datto's
// real Maintenance Policy has no such filter) ──────────────────────────────

async function getHostTimezone(db: Db): Promise<string> {
  const row = await db.select({ timezone: schema.hostSettings.timezone })
    .from(schema.hostSettings).where(eq(schema.hostSettings.id, 1)).get();
  return row?.timezone ?? 'UTC';
}

async function fetchEnabledMaintenancePolicies(db: Db): Promise<MaintenancePolicy[]> {
  return db.select().from(schema.maintenancePolicies).where(eq(schema.maintenancePolicies.enabled, true));
}

async function fetchMaintenancePolicySiteIds(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(schema.maintenancePolicySites);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.policyId)) out.set(r.policyId, new Set());
    out.get(r.policyId)!.add(r.companyId);
  }
  return out;
}

async function fetchMaintenancePolicyDeviceIds(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(schema.maintenancePolicyDevices);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.policyId)) out.set(r.policyId, new Set());
    out.get(r.policyId)!.add(r.deviceId);
  }
  return out;
}

async function fetchMaintenancePolicyGroupIds(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(schema.maintenancePolicyGroups);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.policyId)) out.set(r.policyId, new Set());
    out.get(r.policyId)!.add(r.groupId);
  }
  return out;
}

// Exact mirror of deviceMatchesPolicy's OR-across-three-kinds body in
// lib/alerts.ts, minus the OS/Class gate. Duplicated rather than shared,
// consistent with this codebase's existing per-policy-type mirroring
// convention (see policySites' own comment: "mirrors policyGroups' exact
// composite-PK shape").
function deviceMatchesMaintenancePolicy(
  p: MaintenancePolicy,
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

export interface MaintenanceContext {
  now: number;
  hostTimezone: string;
  policies: MaintenancePolicy[];
  policySiteIds: Map<string, Set<string>>;
  policyDeviceIds: Map<string, Set<string>>;
  policyGroupIds: Map<string, Set<string>>;
  deviceGroupIds: Map<string, Set<string>>; // deviceId -> groupIds
}

// Fetch every map ONCE per invocation — same hot-path rule
// fetchEnabledPolicyMonitors/fetchPolicySiteIds etc. already established in
// lib/alerts.ts (this runs on every 60s check-in and the 2-min fleet cron).
// Callers: isDeviceSuppressedNow below (single-device — check-in, audit) and
// evaluateOfflineAlerts in lib/alerts.ts (fleet-wide, fetched once for ALL
// devices before its device loop).
export async function fetchMaintenanceContext(db: Db, deviceIds: string[], now: number): Promise<MaintenanceContext> {
  const [hostTimezone, policies, policySiteIds, policyDeviceIds, policyGroupIds, deviceGroupIds] = await Promise.all([
    getHostTimezone(db),
    fetchEnabledMaintenancePolicies(db),
    fetchMaintenancePolicySiteIds(db),
    fetchMaintenancePolicyDeviceIds(db),
    fetchMaintenancePolicyGroupIds(db),
    fetchDeviceGroupIds(db, deviceIds), // reused from lib/alerts.ts — same underlying device_group_members table
  ]);
  return { now, hostTimezone, policies, policySiteIds, policyDeviceIds, policyGroupIds, deviceGroupIds };
}

// The single centralized suppression check, replacing the 3 previously
// duplicated inline `device.maintenanceEndsAt != null && ... > now` checks
// in lib/alerts.ts (evaluateOfflineAlerts), routes/checkin.ts, and
// routes/audit.ts. ORs (a) the existing ad-hoc per-device window with (b)
// any enabled Maintenance Policy that both targets this device and has an
// active window right now. No reconcile-on-narrow is needed for (b) — this
// is a pure, stateless gate recomputed fresh on every evaluation, unlike
// alert_state's sticky is_alerting flag, so narrowing/disabling/deleting a
// Maintenance Policy takes effect automatically on the next evaluation.
export function isDeviceSuppressed(device: Device, ctx: MaintenanceContext): boolean {
  if (device.maintenanceEndsAt != null && device.maintenanceEndsAt > ctx.now) return true;

  const deviceGroups = ctx.deviceGroupIds.get(device.id) ?? new Set<string>();
  return ctx.policies.some(policy =>
    deviceMatchesMaintenancePolicy(policy, device, deviceGroups, ctx.policyGroupIds, ctx.policySiteIds, ctx.policyDeviceIds)
    && isMaintenanceWindowActive(policy, ctx.hostTimezone, ctx.now));
}

// Single-device convenience wrapper — mirrors resolveEffectiveMonitors in
// lib/alerts.ts (same role: check-in/audit only ever evaluate one device per
// invocation, so a context fetched for a 1-element deviceIds array is still
// "fetch once per invocation," just a trivially small one).
export async function isDeviceSuppressedNow(db: Db, device: Device, now: number): Promise<boolean> {
  const ctx = await fetchMaintenanceContext(db, [device.id], now);
  return isDeviceSuppressed(device, ctx);
}

// ── Admin CRUD support ──────────────────────────────────────────────────────
// Shared helpers used by routes/admin/maintenance-policies.ts, kept here
// rather than duplicated into the route file since they touch the same
// tables/types this file already owns.

export async function copyMaintenanceTargets(DB: D1Database, sourcePolicyId: string, newPolicyId: string, now: number): Promise<void> {
  const db = drizzle(DB, { schema });
  const [sites, devices, groups] = await Promise.all([
    db.select().from(schema.maintenancePolicySites).where(eq(schema.maintenancePolicySites.policyId, sourcePolicyId)),
    db.select().from(schema.maintenancePolicyDevices).where(eq(schema.maintenancePolicyDevices.policyId, sourcePolicyId)),
    db.select().from(schema.maintenancePolicyGroups).where(eq(schema.maintenancePolicyGroups.policyId, sourcePolicyId)),
  ]);
  await Promise.all([
    ...sites.map(s => db.insert(schema.maintenancePolicySites).values({ policyId: newPolicyId, companyId: s.companyId, createdAt: now })),
    ...devices.map(d => db.insert(schema.maintenancePolicyDevices).values({ policyId: newPolicyId, deviceId: d.deviceId, createdAt: now })),
    ...groups.map(g => db.insert(schema.maintenancePolicyGroups).values({ policyId: newPolicyId, groupId: g.groupId, createdAt: now })),
  ]);
}
