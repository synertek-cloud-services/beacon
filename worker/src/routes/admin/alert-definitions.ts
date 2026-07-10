import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';

const alertDefs = new Hono<{ Bindings: Bindings }>();

function requireAdmin(auth: string | undefined, secret: string): boolean {
  return auth === `Bearer ${secret}`;
}

alertDefs.get('/', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  const tenantId = c.req.query('tenant_id');
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const defs = await db.select()
    .from(schema.alertDefinitions)
    .where(eq(schema.alertDefinitions.tenantId, tenantId));

  return c.json(defs);
});

alertDefs.post('/', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    tenant_id: string;
    device_id?: string;
    device_class?: 'server' | 'workstation' | 'laptop';
    check_type: 'disk_space' | 'offline';
    threshold: unknown;
    consecutive_failures_required?: number;
  }>();

  const id = crypto.randomUUID();
  await db.insert(schema.alertDefinitions).values({
    id,
    tenantId: body.tenant_id,
    deviceId: body.device_id ?? null,
    deviceClass: body.device_class ?? null,
    checkType: body.check_type,
    threshold: JSON.stringify(body.threshold),
    consecutiveFailuresRequired: body.consecutive_failures_required ?? 3,
    createdAt: now,
  });

  return c.json({ definition_id: id });
});

alertDefs.delete('/:id', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.alertDefinitions)
    .where(eq(schema.alertDefinitions.id, c.req.param('id')));
  return c.json({ ok: true });
});

export default alertDefs;
