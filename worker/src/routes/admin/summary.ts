import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireAdmin } from '../../lib/auth';

const adminSummary = new Hono<{ Bindings: Bindings }>();

adminSummary.get('/', async (c) => {
  if (!(await requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))) {
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
  }).from(schema.devices).all();

  const approved = devices.filter(d => d.status === 'approved');

  const byOs: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  let online = 0;

  for (const d of approved) {
    if (d.lastSeen && d.lastSeen > onlineThreshold) online++;

    const os = d.osType ?? 'unknown';
    byOs[os] = (byOs[os] ?? 0) + 1;

    const cls = d.overrideClass ?? d.detectedClass ?? 'unknown';
    byClass[cls] = (byClass[cls] ?? 0) + 1;
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
  });
});

export default adminSummary;
