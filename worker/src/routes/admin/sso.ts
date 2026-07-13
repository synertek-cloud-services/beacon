import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser, type Role } from '../../lib/auth';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { getAppOnlyGraphToken, searchGroups } from '../../lib/oidc';

const adminSso = new Hono<{ Bindings: Bindings }>();

function auth(c: any) {
  return requireUser(c.req.header('Authorization'), c.env, 'admin');
}

function toPublicProvider(p: typeof schema.ssoProviders.$inferSelect) {
  const { clientSecretCiphertext, clientSecretNonce, ...rest } = p;
  return { ...rest, hasSecret: true };
}

// ── Providers ─────────────────────────────────────────────────

// GET /providers — list configured SSO providers (secret never returned)
adminSso.get('/providers', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const rows = await drizzle(c.env.DB, { schema }).select().from(schema.ssoProviders).all();
  return c.json(rows.map(toPublicProvider));
});

// POST /providers — configure a new provider
adminSso.post('/providers', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ name?: string; directoryId?: string; clientId?: string; clientSecret?: string }>();
  if (!body.name || !body.directoryId || !body.clientId || !body.clientSecret) {
    return c.json({ error: 'name, directoryId, clientId, and clientSecret are required' }, 400);
  }

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const { ciphertext, nonce } = await encryptSecret(body.clientSecret, c.env.CONFIG_ENCRYPTION_KEY);

  const id = crypto.randomUUID();
  await db.insert(schema.ssoProviders).values({
    id,
    type: 'microsoft',
    name: body.name,
    directoryId: body.directoryId,
    clientId: body.clientId,
    clientSecretCiphertext: ciphertext,
    clientSecretNonce: nonce,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ id }, 201);
});

// PATCH /providers/:id — update config; clientSecret only rewritten if provided
adminSso.patch('/providers/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ name?: string; directoryId?: string; clientId?: string; clientSecret?: string; enabled?: boolean }>();
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const updates: Partial<typeof schema.ssoProviders.$inferInsert> = { updatedAt: now };
  if (body.name !== undefined) updates.name = body.name;
  if (body.directoryId !== undefined) updates.directoryId = body.directoryId;
  if (body.clientId !== undefined) updates.clientId = body.clientId;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.clientSecret) {
    const { ciphertext, nonce } = await encryptSecret(body.clientSecret, c.env.CONFIG_ENCRYPTION_KEY);
    updates.clientSecretCiphertext = ciphertext;
    updates.clientSecretNonce = nonce;
  }

  await db.update(schema.ssoProviders).set(updates).where(eq(schema.ssoProviders.id, c.req.param('id')));
  return c.json({ ok: true });
});

// DELETE /providers/:id
adminSso.delete('/providers/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.ssoGroupRoleMappings).where(eq(schema.ssoGroupRoleMappings.ssoProviderId, c.req.param('id')));
  await db.delete(schema.ssoProviders).where(eq(schema.ssoProviders.id, c.req.param('id')));
  return c.json({ ok: true });
});

// GET /providers/:id/groups?search=<query> — live search of the tenant's Entra
// security groups, so admins can pick a group instead of pasting its Object ID.
adminSso.get('/providers/:id/groups', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const query = (c.req.query('search') ?? '').trim();
  if (!query) return c.json([]);

  const db = drizzle(c.env.DB, { schema });
  const provider = await db.select().from(schema.ssoProviders).where(eq(schema.ssoProviders.id, c.req.param('id'))).get();
  if (!provider) return c.json({ error: 'provider not found' }, 404);

  try {
    const clientSecret = await decryptSecret(provider.clientSecretCiphertext, provider.clientSecretNonce, c.env.CONFIG_ENCRYPTION_KEY);
    const token = await getAppOnlyGraphToken(provider.directoryId, provider.clientId, clientSecret);
    const groups = await searchGroups(token, query);
    return c.json(groups);
  } catch {
    return c.json({ error: 'group search failed — confirm Group.Read.All (Application permission) is added and admin-consented in the Entra app registration' }, 502);
  }
});

// ── Group → role mappings ────────────────────────────────────

// GET /providers/:id/group-mappings
adminSso.get('/providers/:id/group-mappings', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const rows = await drizzle(c.env.DB, { schema })
    .select()
    .from(schema.ssoGroupRoleMappings)
    .where(eq(schema.ssoGroupRoleMappings.ssoProviderId, c.req.param('id')))
    .all();
  return c.json(rows);
});

// POST /providers/:id/group-mappings
adminSso.post('/providers/:id/group-mappings', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ groupId?: string; groupName?: string; role?: Role }>();
  if (!body.groupId || !body.role) return c.json({ error: 'groupId and role are required' }, 400);

  const db = drizzle(c.env.DB, { schema });
  const id = crypto.randomUUID();
  await db.insert(schema.ssoGroupRoleMappings).values({
    id,
    ssoProviderId: c.req.param('id'),
    groupId: body.groupId,
    groupName: body.groupName ?? null,
    role: body.role,
    createdAt: Math.floor(Date.now() / 1000),
  });

  return c.json({ id }, 201);
});

// DELETE /providers/:id/group-mappings/:mappingId
adminSso.delete('/providers/:id/group-mappings/:mappingId', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.ssoGroupRoleMappings).where(eq(schema.ssoGroupRoleMappings.id, c.req.param('mappingId')));
  return c.json({ ok: true });
});

export default adminSso;
