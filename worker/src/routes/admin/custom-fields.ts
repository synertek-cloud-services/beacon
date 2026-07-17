import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, asc } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';

const adminCustomFields = new Hono<{ Bindings: Bindings }>();

// Field definitions are configuration (like SSO providers), not routine
// device data — admin only, matching the Settings-area role convention.
function auth(c: any) {
  return requireUser(c.req.header('Authorization'), c.env, 'admin');
}

// GET / — list field definitions, sort_order ascending
adminCustomFields.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const rows = await drizzle(c.env.DB, { schema })
    .select()
    .from(schema.customFields)
    .orderBy(asc(schema.customFields.sortOrder))
    .all();

  return c.json(rows);
});

// POST / — create a field definition, appended after the current highest sort_order
adminCustomFields.post('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const db = drizzle(c.env.DB, { schema });
  const existing = await db.select().from(schema.customFields).all();
  const nextSortOrder = existing.reduce((max, f) => Math.max(max, f.sortOrder), -1) + 1;

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.customFields).values({ id, name, sortOrder: nextSortOrder, createdAt: now });

  return c.json({ id }, 201);
});

// PATCH /:id — rename and/or reorder
adminCustomFields.patch('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ name?: string; sort_order?: number }>();
  const updates: Partial<typeof schema.customFields.$inferInsert> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return c.json({ error: 'name cannot be empty' }, 400);
    updates.name = name;
  }
  if (body.sort_order !== undefined) updates.sortOrder = body.sort_order;
  if (Object.keys(updates).length === 0) return c.json({ error: 'no recognized fields to update' }, 400);

  const db = drizzle(c.env.DB, { schema });
  const existing = await db.select({ id: schema.customFields.id }).from(schema.customFields).where(eq(schema.customFields.id, c.req.param('id'))).get();
  if (!existing) return c.json({ error: 'not found' }, 404);

  await db.update(schema.customFields).set(updates).where(eq(schema.customFields.id, c.req.param('id')));
  return c.json({ ok: true });
});

// DELETE /:id — also removes every device's stored value (ON DELETE CASCADE)
adminCustomFields.delete('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.customFields).where(eq(schema.customFields.id, c.req.param('id')));
  return c.json({ ok: true });
});

export default adminCustomFields;
