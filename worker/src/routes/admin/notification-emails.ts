import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';

// Standalone alert-notification addresses with no Beacon account (a shared
// mailbox, a ticketing system's inbound address, etc.) -- one of two unioned
// recipient sources, the other being users.receivesAlerts.
const notificationEmails = new Hono<{ Bindings: Bindings }>();

function auth(c: any) {
  return requireUser(c.req.header('Authorization'), c.env, 'admin');
}

notificationEmails.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const rows = await drizzle(c.env.DB, { schema }).select().from(schema.notificationEmails);
  return c.json(rows);
});

notificationEmails.post('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ email?: string }>();
  if (!body.email?.trim()) return c.json({ error: 'email is required' }, 400);
  const db = drizzle(c.env.DB, { schema });
  const id = crypto.randomUUID();
  await db.insert(schema.notificationEmails).values({
    id,
    email: body.email.trim(),
    createdAt: Math.floor(Date.now() / 1000),
  });
  return c.json({ id }, 201);
});

notificationEmails.patch('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ enabled?: boolean; email?: string }>();
  const updates: Partial<typeof schema.notificationEmails.$inferInsert> = {};
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.email !== undefined) {
    if (!body.email.trim()) return c.json({ error: 'email cannot be empty' }, 400);
    updates.email = body.email.trim();
  }
  if (Object.keys(updates).length === 0) return c.json({ error: 'nothing to update' }, 400);
  const db = drizzle(c.env.DB, { schema });
  await db.update(schema.notificationEmails).set(updates).where(eq(schema.notificationEmails.id, c.req.param('id')));
  return c.json({ ok: true });
});

notificationEmails.delete('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.notificationEmails).where(eq(schema.notificationEmails.id, c.req.param('id')));
  return c.json({ ok: true });
});

export default notificationEmails;
