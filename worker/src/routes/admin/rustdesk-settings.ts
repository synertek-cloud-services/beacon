import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';

// Global RustDesk relay/rendezvous server config -- singleton (id=1), see
// schema.rustdeskSettings's own doc comment. Admin-only both ways: unlike
// branding identity, nothing here is consumed pre-login or by the agent yet
// (no agent-side RustDesk install exists), so there's no case for a public
// GET.
async function admin(c: any) { return requireUser(c.req.header('Authorization'), c.env, 'admin'); }

const rustdeskSettings = new Hono<{ Bindings: Bindings }>();

rustdeskSettings.get('/', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'unauthorized' }, 401);
  const row = await drizzle(c.env.DB, { schema }).select().from(schema.rustdeskSettings).where(eq(schema.rustdeskSettings.id, 1)).get();
  return c.json({
    idServer: row?.idServer ?? null,
    relayServer: row?.relayServer ?? null,
    key: row?.key ?? null,
  });
});

rustdeskSettings.patch('/', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ id_server?: string | null; relay_server?: string | null; key?: string | null }>();
  const updates: Partial<typeof schema.rustdeskSettings.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  // No secret-bearing field here (unlike email_settings), so a blank/empty
  // value just clears the column rather than needing a "blank means keep
  // existing" merge -- each field is independently settable to null.
  if (body.id_server !== undefined) updates.idServer = body.id_server?.trim() || null;
  if (body.relay_server !== undefined) updates.relayServer = body.relay_server?.trim() || null;
  if (body.key !== undefined) updates.key = body.key?.trim() || null;
  await drizzle(c.env.DB, { schema }).update(schema.rustdeskSettings).set(updates).where(eq(schema.rustdeskSettings.id, 1));
  return c.json({ ok: true });
});

export default rustdeskSettings;
