import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';

const adminDevices = new Hono<{ Bindings: Bindings }>();

function auth(c: any): boolean {
  const header = c.req.header('Authorization');
  return header === `Bearer ${c.env.ADMIN_SECRET}`;
}

// GET /v1/admin/devices?status=pending|approved|revoked
adminDevices.get('/', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const statusFilter = c.req.query('status') as typeof schema.devices.$inferSelect['status'] | undefined;

  const rows = statusFilter
    ? await db.select().from(schema.devices).where(eq(schema.devices.status, statusFilter)).all()
    : await db.select().from(schema.devices).all();

  return c.json(rows);
});

// GET /v1/admin/devices/:id
adminDevices.get('/:id', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const device = await db.select().from(schema.devices).where(eq(schema.devices.id, c.req.param('id'))).get();
  if (!device) return c.json({ error: 'not found' }, 404);
  return c.json(device);
});

// POST /v1/admin/devices/:id/approve
adminDevices.post('/:id/approve', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const result = await db
    .update(schema.devices)
    .set({ status: 'approved', approvedAt: now })
    .where(eq(schema.devices.id, c.req.param('id')));

  return c.json({ ok: true });
});

// POST /v1/admin/devices/:id/revoke
adminDevices.post('/:id/revoke', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });

  await db
    .update(schema.devices)
    .set({ status: 'revoked' })
    .where(eq(schema.devices.id, c.req.param('id')));

  return c.json({ ok: true });
});

// DELETE /v1/admin/devices/:id
adminDevices.delete('/:id', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.devices).where(eq(schema.devices.id, c.req.param('id')));

  return c.json({ ok: true });
});

export default adminDevices;
