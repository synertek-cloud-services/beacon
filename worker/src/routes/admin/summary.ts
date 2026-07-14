import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';

const adminSummary = new Hono<{ Bindings: Bindings }>();

adminSummary.get('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const onlineThreshold = now - 300; // 5 min — 5× the check-in interval

  const devices = await db.select({
    status: schema.devices.status,
    lastSeen: schema.devices.lastSeen,
    osType: schema.devices.osType,
    detectedClass: schema.devices.detectedClass,
    overrideClass: schema.devices.overrideClass,
    inventory: schema.devices.inventory,
  }).from(schema.devices).all();

  const approved = devices.filter(d => d.status === 'approved');

  const byOs: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  const byAvStatus: Record<string, number> = {};
  let online = 0;

  for (const d of approved) {
    const isOnline = d.lastSeen !== null && d.lastSeen > onlineThreshold;
    if (isOnline) online++;

    const os = d.osType ?? 'unknown';
    byOs[os] = (byOs[os] ?? 0) + 1;

    const cls = d.overrideClass ?? d.detectedClass ?? 'unknown';
    byClass[cls] = (byClass[cls] ?? 0) + 1;

    // av_status isn't a dedicated column — it's only in the raw inventory
    // blob from the last check-in, same as every other Metrics field.
    let avStatus = 'unknown';
    if (d.inventory) {
      try {
        const parsed = JSON.parse(d.inventory) as { av_status?: string };
        if (parsed.av_status) avStatus = parsed.av_status;
      } catch { /* leave as unknown */ }
    }
    byAvStatus[avStatus] = (byAvStatus[avStatus] ?? 0) + 1;
  }

  // "Offline Devices by Type" deliberately does NOT derive from raw
  // last_seen (that's a connectivity fact, not a monitoring concern) — it
  // shows only devices an actual enabled offline monitor is alerting on,
  // same data Global Alerts shows. This means it respects policy scope
  // (e.g. server-only offline policies correctly exclude laptops/
  // workstations entirely, not just de-emphasize them) and the real
  // sustained-minutes threshold, not a hardcoded 5-minute guess.
  const offlineAlertRows = await db.select({
      detectedClass: schema.devices.detectedClass,
      overrideClass: schema.devices.overrideClass,
      config:        schema.policyMonitors.config,
    })
    .from(schema.alertState)
    .innerJoin(schema.policyMonitors, eq(schema.policyMonitors.id, schema.alertState.policyMonitorId))
    .innerJoin(schema.devices, eq(schema.devices.id, schema.alertState.deviceId))
    .where(and(
      eq(schema.policyMonitors.checkType, 'offline'),
      eq(schema.alertState.isAlerting, true),
    ));

  const offlineByClass: Record<string, number> = {};
  for (const row of offlineAlertRows) {
    // "comes online" monitors (direction: 'online') alert because a device
    // IS online — including those here would count a healthy device as
    // offline, so skip anything that isn't the offline direction.
    let direction = 'offline';
    try { direction = (JSON.parse(row.config) as { direction?: string }).direction ?? 'offline'; } catch { /* default stands */ }
    if (direction !== 'offline') continue;

    const cls = row.overrideClass ?? row.detectedClass ?? 'unknown';
    offlineByClass[cls] = (offlineByClass[cls] ?? 0) + 1;
  }

  return c.json({
    total: devices.length,
    approved: approved.length,
    pending: devices.filter(d => d.status === 'pending').length,
    revoked: devices.filter(d => d.status === 'revoked').length,
    online,
    offline: approved.length - online,
    by_os: byOs,
    by_class: byClass,
    offline_by_class: offlineByClass,
    by_av_status: byAvStatus,
  });
});

export default adminSummary;
