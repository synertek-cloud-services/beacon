import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../index';
import * as schema from '../db/schema';
import { requireUser } from '../lib/auth';
import { verifyPassword } from '../lib/password';
import { sha256hex, generateToken } from '../lib/crypto';

const auth = new Hono<{ Bindings: Bindings }>();

const SESSION_TTL_SECONDS = 12 * 60 * 60;

// POST /v1/auth/login — local email/password login
auth.post('/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) return c.json({ error: 'email and password are required' }, 400);

  const db = drizzle(c.env.DB, { schema });
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();

  // Same generic error for "no such user" and "wrong password" — avoid enumeration.
  const invalid = () => c.json({ error: 'invalid email or password' }, 401);

  if (!user || user.authSource !== 'local' || !user.passwordHash) return invalid();
  if (user.status !== 'active') return invalid();
  if (!(await verifyPassword(password, user.passwordHash))) return invalid();

  const now = Math.floor(Date.now() / 1000);
  const token = generateToken();
  await db.insert(schema.userSessions).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: await sha256hex(token),
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS,
    userAgent: c.req.header('User-Agent') ?? null,
    ip: c.req.header('CF-Connecting-IP') ?? null,
  });
  await db.update(schema.users).set({ lastLoginAt: now }).where(eq(schema.users.id, user.id));

  return c.json({
    token,
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource },
  });
});

// POST /v1/auth/logout — revoke the current session
auth.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  const user = await requireUser(authHeader, c.env);
  if (!user || user.source !== 'session') return c.json({ ok: true }); // nothing to revoke (e.g. break-glass)

  const token = authHeader!.slice('Bearer '.length);
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.userSessions)
    .set({ revokedAt: now })
    .where(eq(schema.userSessions.tokenHash, await sha256hex(token)));

  return c.json({ ok: true });
});

// GET /v1/auth/me — current identity, used by the dashboard to bootstrap current-user state
auth.get('/me', async (c) => {
  const user = await requireUser(c.req.header('Authorization'), c.env);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json(user);
});

export default auth;
