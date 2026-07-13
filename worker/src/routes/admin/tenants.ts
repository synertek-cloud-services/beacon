import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { sha256hex, generateToken } from '../../lib/crypto';
import { requireAdmin } from '../../lib/auth';

const adminTenants = new Hono<{ Bindings: Bindings }>();

function auth(c: any): Promise<boolean> {
  return requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET);
}

// ── Tenants ───────────────────────────────────────────────────

// GET / — list tenants with device counts and primary contact via subqueries
adminTenants.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const result = await c.env.DB.prepare(`
    SELECT
      t.id, t.name, t.auto_approve_default, t.privacy_mode_default, t.status,
      t.created_at, t.website, t.notes,
      (SELECT count(*) FROM devices WHERE tenant_id = t.id) AS device_count,
      (SELECT name  FROM tenant_contacts WHERE tenant_id = t.id AND is_primary = 1 LIMIT 1) AS primary_contact_name,
      (SELECT email FROM tenant_contacts WHERE tenant_id = t.id AND is_primary = 1 LIMIT 1) AS primary_contact_email
    FROM tenants t
    ORDER BY t.created_at ASC
  `).all<{
    id: string; name: string; auto_approve_default: number; privacy_mode_default: number;
    status: string; created_at: number; website: string | null; notes: string | null;
    device_count: number; primary_contact_name: string | null; primary_contact_email: string | null;
  }>();

  return c.json(result.results.map(r => ({
    id: r.id,
    name: r.name,
    autoApproveDefault: !!r.auto_approve_default,
    privacyModeDefault: !!r.privacy_mode_default,
    status: r.status,
    createdAt: r.created_at,
    deviceCount: r.device_count,
    website: r.website,
    notes: r.notes,
    primaryContactName: r.primary_contact_name,
    primaryContactEmail: r.primary_contact_email,
  })));
});

// POST / — create tenant + optional initial contact
adminTenants.post('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    name: string;
    auto_approve_default?: boolean;
    privacy_mode_default?: boolean;
    website?: string;
    notes?: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
  }>();

  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

  const id = crypto.randomUUID();
  await db.insert(schema.tenants).values({
    id,
    name: body.name.trim(),
    autoApproveDefault: body.auto_approve_default ?? true,
    privacyModeDefault: body.privacy_mode_default ?? false,
    website: body.website || null,
    notes: body.notes || null,
    createdAt: now,
  });

  if (body.contact_name?.trim()) {
    await db.insert(schema.tenantContacts).values({
      id: crypto.randomUUID(),
      tenantId: id,
      name: body.contact_name.trim(),
      email: body.contact_email || null,
      phone: body.contact_phone || null,
      isPrimary: true,
      createdAt: now,
    });
  }

  const tenant = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id)).get();
  return c.json({
    ...tenant,
    deviceCount: 0,
    primaryContactName: body.contact_name?.trim() || null,
    primaryContactEmail: body.contact_email || null,
  }, 201);
});

// PATCH /:id — update company info and settings
adminTenants.patch('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const body = await c.req.json<{
    name?: string;
    auto_approve_default?: boolean;
    privacy_mode_default?: boolean;
    status?: 'active' | 'suspended';
    website?: string | null;
    notes?: string | null;
  }>();

  const updates: Partial<typeof schema.tenants.$inferInsert> = {};
  if (body.name !== undefined)                 updates.name = body.name.trim();
  if (body.auto_approve_default !== undefined) updates.autoApproveDefault = body.auto_approve_default;
  if (body.privacy_mode_default !== undefined) updates.privacyModeDefault = body.privacy_mode_default;
  if (body.status !== undefined)               updates.status = body.status;
  if ('website' in body)                       updates.website = body.website ?? null;
  if ('notes'   in body)                       updates.notes   = body.notes   ?? null;

  if (Object.keys(updates).length === 0) return c.json({ error: 'nothing to update' }, 400);

  await db.update(schema.tenants).set(updates).where(eq(schema.tenants.id, c.req.param('id')));
  return c.json({ ok: true });
});

// ── Contacts ──────────────────────────────────────────────────

adminTenants.get('/:id/contacts', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const contacts = await db
    .select()
    .from(schema.tenantContacts)
    .where(eq(schema.tenantContacts.tenantId, c.req.param('id')))
    .all();

  return c.json(contacts);
});

adminTenants.post('/:id/contacts', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const tenantId = c.req.param('id');

  const body = await c.req.json<{
    name: string;
    title?: string | null;
    email?: string | null;
    phone?: string | null;
    is_primary?: boolean;
  }>();

  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

  if (body.is_primary) {
    await db.update(schema.tenantContacts)
      .set({ isPrimary: false })
      .where(eq(schema.tenantContacts.tenantId, tenantId));
  }

  const id = crypto.randomUUID();
  await db.insert(schema.tenantContacts).values({
    id,
    tenantId,
    name: body.name.trim(),
    title: body.title || null,
    email: body.email || null,
    phone: body.phone || null,
    isPrimary: body.is_primary ?? false,
    createdAt: now,
  });

  const contact = await db.select().from(schema.tenantContacts).where(eq(schema.tenantContacts.id, id)).get();
  return c.json(contact, 201);
});

adminTenants.patch('/:id/contacts/:contactId', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const tenantId = c.req.param('id');
  const contactId = c.req.param('contactId');

  const body = await c.req.json<{
    name?: string;
    title?: string | null;
    email?: string | null;
    phone?: string | null;
    is_primary?: boolean;
  }>();

  if (body.is_primary) {
    await db.update(schema.tenantContacts)
      .set({ isPrimary: false })
      .where(eq(schema.tenantContacts.tenantId, tenantId));
  }

  const updates: Partial<typeof schema.tenantContacts.$inferInsert> = {};
  if (body.name !== undefined)      updates.name     = body.name.trim();
  if ('title' in body)              updates.title    = body.title ?? null;
  if ('email' in body)              updates.email    = body.email ?? null;
  if ('phone' in body)              updates.phone    = body.phone ?? null;
  if (body.is_primary !== undefined) updates.isPrimary = body.is_primary;

  if (Object.keys(updates).length === 0) return c.json({ error: 'nothing to update' }, 400);

  await db.update(schema.tenantContacts).set(updates).where(eq(schema.tenantContacts.id, contactId));
  return c.json({ ok: true });
});

adminTenants.delete('/:id/contacts/:contactId', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  await db.delete(schema.tenantContacts).where(eq(schema.tenantContacts.id, c.req.param('contactId')));
  return c.json({ ok: true });
});

// ── Locations ─────────────────────────────────────────────────

adminTenants.get('/:id/locations', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const locations = await db
    .select()
    .from(schema.tenantLocations)
    .where(eq(schema.tenantLocations.tenantId, c.req.param('id')))
    .all();

  return c.json(locations);
});

adminTenants.post('/:id/locations', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const tenantId = c.req.param('id');

  const body = await c.req.json<{
    name: string;
    is_primary?: boolean;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    country?: string | null;
  }>();

  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

  if (body.is_primary) {
    await db.update(schema.tenantLocations)
      .set({ isPrimary: false })
      .where(eq(schema.tenantLocations.tenantId, tenantId));
  }

  const id = crypto.randomUUID();
  await db.insert(schema.tenantLocations).values({
    id,
    tenantId,
    name: body.name.trim(),
    isPrimary: body.is_primary ?? false,
    street: body.street || null,
    city: body.city || null,
    state: body.state || null,
    zip: body.zip || null,
    country: body.country || null,
    createdAt: now,
  });

  const location = await db.select().from(schema.tenantLocations).where(eq(schema.tenantLocations.id, id)).get();
  return c.json(location, 201);
});

adminTenants.patch('/:id/locations/:locationId', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const tenantId = c.req.param('id');
  const locationId = c.req.param('locationId');

  const body = await c.req.json<{
    name?: string;
    is_primary?: boolean;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    country?: string | null;
  }>();

  if (body.is_primary) {
    await db.update(schema.tenantLocations)
      .set({ isPrimary: false })
      .where(eq(schema.tenantLocations.tenantId, tenantId));
  }

  const updates: Partial<typeof schema.tenantLocations.$inferInsert> = {};
  if (body.name !== undefined)       updates.name      = body.name.trim();
  if (body.is_primary !== undefined) updates.isPrimary = body.is_primary;
  if ('street'  in body)             updates.street  = body.street  ?? null;
  if ('city'    in body)             updates.city    = body.city    ?? null;
  if ('state'   in body)             updates.state   = body.state   ?? null;
  if ('zip'     in body)             updates.zip     = body.zip     ?? null;
  if ('country' in body)             updates.country = body.country ?? null;

  if (Object.keys(updates).length === 0) return c.json({ error: 'nothing to update' }, 400);

  await db.update(schema.tenantLocations).set(updates).where(eq(schema.tenantLocations.id, locationId));
  return c.json({ ok: true });
});

adminTenants.delete('/:id/locations/:locationId', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  await db.delete(schema.tenantLocations).where(eq(schema.tenantLocations.id, c.req.param('locationId')));
  return c.json({ ok: true });
});

// ── Enrollment Tokens ─────────────────────────────────────────

adminTenants.get('/:id/tokens', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const tokens = await db
    .select()
    .from(schema.enrollmentTokens)
    .where(eq(schema.enrollmentTokens.tenantId, c.req.param('id')))
    .all();

  return c.json(tokens.map(({ tokenHash: _, ...t }) => t));
});

adminTenants.post('/:id/tokens', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
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

  return c.json({ id, raw_token: rawToken, expires_at: expiresAt, max_uses: body.max_uses ?? null }, 201);
});

adminTenants.delete('/:id/tokens/:tokenId', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  await db
    .update(schema.enrollmentTokens)
    .set({ revokedAt: now })
    .where(eq(schema.enrollmentTokens.id, c.req.param('tokenId')));

  return c.json({ ok: true });
});

adminTenants.delete('/:id/tokens/:tokenId/permanent', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  await db
    .delete(schema.enrollmentTokens)
    .where(eq(schema.enrollmentTokens.id, c.req.param('tokenId')));

  return c.json({ ok: true });
});

export default adminTenants;
