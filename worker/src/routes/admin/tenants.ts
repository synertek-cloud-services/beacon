import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, sql } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { sha256hex, generateToken } from '../../lib/crypto';

const adminTenants = new Hono<{ Bindings: Bindings }>();

function auth(c: any): boolean {
  return c.req.header('Authorization') === `Bearer ${c.env.ADMIN_SECRET}`;
}

// GET /v1/admin/tenants — list all tenants with device counts
adminTenants.get('/', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const tenants = await db.select().from(schema.tenants).all();

  // Fetch device counts per tenant
  const counts = await db
    .select({ tenantId: schema.devices.tenantId, count: sql<number>`count(*)` })
    .from(schema.devices)
    .groupBy(schema.devices.tenantId)
    .all();

  const countMap = Object.fromEntries(counts.map(r => [r.tenantId, r.count]));

  return c.json(tenants.map(t => ({ ...t, deviceCount: countMap[t.id] ?? 0 })));
});

// POST /v1/admin/tenants — create a tenant
adminTenants.post('/', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    name: string;
    auto_approve_default?: boolean;
    privacy_mode_default?: boolean;
  }>();

  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

  const id = crypto.randomUUID();
  await db.insert(schema.tenants).values({
    id,
    name: body.name.trim(),
    autoApproveDefault: body.auto_approve_default ?? true,
    privacyModeDefault: body.privacy_mode_default ?? false,
    createdAt: now,
  });

  const tenant = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id)).get();
  return c.json({ ...tenant, deviceCount: 0 }, 201);
});

// PATCH /v1/admin/tenants/:id — update name / settings / status
adminTenants.patch('/:id', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const body = await c.req.json<{
    name?: string;
    auto_approve_default?: boolean;
    privacy_mode_default?: boolean;
    status?: 'active' | 'suspended';
  }>();

  const updates: Partial<typeof schema.tenants.$inferInsert> = {};
  if (body.name !== undefined)                 updates.name = body.name.trim();
  if (body.auto_approve_default !== undefined) updates.autoApproveDefault = body.auto_approve_default;
  if (body.privacy_mode_default !== undefined) updates.privacyModeDefault = body.privacy_mode_default;
  if (body.status !== undefined)               updates.status = body.status;

  if (Object.keys(updates).length === 0) return c.json({ error: 'nothing to update' }, 400);

  await db.update(schema.tenants).set(updates).where(eq(schema.tenants.id, c.req.param('id')));
  return c.json({ ok: true });
});

// GET /v1/admin/tenants/:id/tokens — list enrollment tokens
adminTenants.get('/:id/tokens', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const tokens = await db
    .select()
    .from(schema.enrollmentTokens)
    .where(eq(schema.enrollmentTokens.tenantId, c.req.param('id')))
    .all();

  // Never return the hash; return everything else
  return c.json(tokens.map(({ tokenHash: _, ...t }) => t));
});

// POST /v1/admin/tenants/:id/tokens — create enrollment token
// Returns the raw token ONCE — it is never stored in plaintext
adminTenants.post('/:id/tokens', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const tenant = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, c.req.param('id')))
    .get();
  if (!tenant) return c.json({ error: 'tenant not found' }, 404);

  const body: { auto_approve?: boolean | null; max_uses?: number | null; expires_in_days?: number | null } =
    await c.req.json().catch(() => ({}));

  const rawToken = generateToken();
  const tokenHash = await sha256hex(rawToken);

  const id = crypto.randomUUID();
  const expiresAt = body.expires_in_days ? now + body.expires_in_days * 86400 : null;

  await db.insert(schema.enrollmentTokens).values({
    id,
    tenantId: c.req.param('id'),
    tokenHash,
    autoApprove: body.auto_approve ?? null,
    maxUses: body.max_uses ?? null,
    expiresAt,
    createdBy: 'admin',
    createdAt: now,
  });

  // rawToken is returned here and never stored — copy it now
  return c.json({ id, raw_token: rawToken, expires_at: expiresAt, max_uses: body.max_uses ?? null }, 201);
});

// DELETE /v1/admin/tenants/:id/tokens/:tokenId — revoke a token
adminTenants.delete('/:id/tokens/:tokenId', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  await db
    .update(schema.enrollmentTokens)
    .set({ revokedAt: now })
    .where(eq(schema.enrollmentTokens.id, c.req.param('tokenId')));

  return c.json({ ok: true });
});

export default adminTenants;
