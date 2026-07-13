import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireAdmin } from '../../lib/auth';

const adminCommands = new Hono<{ Bindings: Bindings }>();

adminCommands.post('/', async (c) => {
  if (!(await requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json<{
    device_id: string;
    tenant_id: string;
    type: string;
    payload: unknown;
  }>();

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  // Verify device exists and belongs to the stated tenant
  const device = await db.select({ id: schema.devices.id })
    .from(schema.devices)
    .where(and(
      eq(schema.devices.id, body.device_id),
      eq(schema.devices.tenantId, body.tenant_id),
      eq(schema.devices.status, 'approved'),
    ))
    .get();

  if (!device) return c.json({ error: 'device not found or not approved' }, 404);

  const id = crypto.randomUUID();
  await db.insert(schema.commands).values({
    id,
    deviceId: body.device_id,
    tenantId: body.tenant_id,
    type: body.type,
    payload: JSON.stringify(body.payload),
    createdAt: now,
  });

  return c.json({ command_id: id });
});

export default adminCommands;
