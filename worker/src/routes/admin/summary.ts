import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
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
  const offlineByClass: Record<string, number> = {};
  const byAvStatus: Record<string, number> = {};
  let online = 0;

  for (const d of approved) {
    const isOnline = d.lastSeen !== null && d.lastSeen > onlineThreshold;
    if (isOnline) online++;

    const os = d.osType ?? 'unknown';
    byOs[os] = (byOs[os] ?? 0) + 1;

    const cls = d.overrideClass ?? d.detectedClass ?? 'unknown';
    byClass[cls] = (byClass[cls] ?? 0) + 1;
    if (!isOnline) offlineByClass[cls] = (offlineByClass[cls] ?? 0) + 1;

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
