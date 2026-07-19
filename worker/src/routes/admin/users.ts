import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser, type Role } from '../../lib/auth';
import { hashPassword } from '../../lib/password';

const adminUsers = new Hono<{ Bindings: Bindings }>();

function auth(c: any) {
  return requireUser(c.req.header('Authorization'), c.env, 'admin');
}

function toPublicUser(u: typeof schema.users.$inferSelect) {
  const { passwordHash, ...rest } = u;
  return rest;
}

// GET / — list users
adminUsers.get('/', async (c) => {
  const user = await auth(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const rows = await drizzle(c.env.DB, { schema }).select().from(schema.users).all();
  return c.json(rows.map(toPublicUser));
});

// POST / — create a local user
adminUsers.post('/', async (c) => {
  const authedUser = await auth(c);
  if (!authedUser) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ email?: string; displayName?: string; role?: Role; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password || !body.role) return c.json({ error: 'email, password, and role are required' }, 400);

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get();
  if (existing) return c.json({ error: 'a user with that email already exists' }, 409);

  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    email,
    displayName: body.displayName ?? null,
    role: body.role,
    passwordHash: await hashPassword(body.password),
    authSource: 'local',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: authedUser.email,
  });

  return c.json({ id }, 201);
});

// PATCH /:id — update role, display name, or status
adminUsers.patch('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ displayName?: string; role?: Role; status?: 'active' | 'disabled'; receivesAlerts?: boolean }>();
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const updates: Partial<typeof schema.users.$inferInsert> = { updatedAt: now };
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.role !== undefined) updates.role = body.role;
  if (body.status !== undefined) updates.status = body.status;
  if (body.receivesAlerts !== undefined) updates.receivesAlerts = body.receivesAlerts;

  await db.update(schema.users).set(updates).where(eq(schema.users.id, c.req.param('id')));
  return c.json({ ok: true });
});

// POST /:id/reset-password — admin sets a new password directly (no email flow)
adminUsers.post('/:id/reset-password', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ password?: string }>();
  if (!body.password) return c.json({ error: 'password is required' }, 400);

  const db = drizzle(c.env.DB, { schema });
  const target = await db.select().from(schema.users).where(eq(schema.users.id, c.req.param('id'))).get();
  if (!target) return c.json({ error: 'not found' }, 404);
  if (target.authSource !== 'local') return c.json({ error: 'this account signs in via SSO — password reset must happen with the identity provider' }, 400);

  await db.update(schema.users)
    .set({ passwordHash: await hashPassword(body.password), updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.users.id, c.req.param('id')));

  return c.json({ ok: true });
});

// DELETE /:id — soft-disable, matching the tenants.status/devices.status suspend-don't-delete convention
adminUsers.delete('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  await db.update(schema.users)
    .set({ status: 'disabled', updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.users.id, c.req.param('id')));

  return c.json({ ok: true });
});

export default adminUsers;
