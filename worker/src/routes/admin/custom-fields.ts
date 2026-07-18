import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, asc, and, ne } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';

const adminCustomFields = new Hono<{ Bindings: Bindings }>();

// Field definitions are configuration (like SSO providers), not routine
// device data — admin only, matching the Settings-area role convention.
function auth(c: any) {
  return requireUser(c.req.header('Authorization'), c.env, 'admin');
}

// Identifier form of a field's name, used to build the CF_<KEY> env var a
// script can reference (see worker/src/routes/admin/jobs.ts's
// fetchCustomFieldVars). Uppercase-only — stricter than component_variables'
// mixed-case VARIABLE_NAME_RE, since env var convention is uppercase and this
// is auto-derived from the display name anyway.
const CUSTOM_FIELD_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase();
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

  const body = await c.req.json<{ name?: string; key?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const db = drizzle(c.env.DB, { schema });

  let key = '';
  if (body.key !== undefined && body.key.trim() !== '') {
    key = normalizeKey(body.key);
    if (!CUSTOM_FIELD_KEY_RE.test(key)) {
      return c.json({ error: 'key must be a valid identifier (A-Z, 0-9, underscore, not starting with a digit)' }, 400);
    }
    const dup = await db.select({ id: schema.customFields.id }).from(schema.customFields).where(eq(schema.customFields.key, key)).get();
    if (dup) return c.json({ error: `a custom field with key "${key}" already exists` }, 409);
  }

  const existing = await db.select().from(schema.customFields).all();
  const nextSortOrder = existing.reduce((max, f) => Math.max(max, f.sortOrder), -1) + 1;

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.customFields).values({ id, name, key, sortOrder: nextSortOrder, createdAt: now });

  return c.json({ id }, 201);
});

// PATCH /:id — rename, reorder, and/or change key (key changes are guarded —
// see the reference scan below)
adminCustomFields.patch('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');

  const body = await c.req.json<{ name?: string; sort_order?: number; key?: string }>();
  const db = drizzle(c.env.DB, { schema });

  const existing = await db.select({ id: schema.customFields.id, key: schema.customFields.key })
    .from(schema.customFields).where(eq(schema.customFields.id, id)).get();
  if (!existing) return c.json({ error: 'not found' }, 404);

  const updates: Partial<typeof schema.customFields.$inferInsert> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return c.json({ error: 'name cannot be empty' }, 400);
    updates.name = name;
  }
  if (body.sort_order !== undefined) updates.sortOrder = body.sort_order;

  if (body.key !== undefined) {
    const newKey = body.key.trim() === '' ? '' : normalizeKey(body.key);
    if (newKey !== '' && !CUSTOM_FIELD_KEY_RE.test(newKey)) {
      return c.json({ error: 'key must be a valid identifier (A-Z, 0-9, underscore, not starting with a digit)' }, 400);
    }
    if (newKey !== existing.key) {
      // Only guard when there WAS a real previous key -- an empty oldKey
      // would make the substring check below match "CF_" anywhere, which is
      // meaningless (nothing could have referenced a key that never existed).
      if (existing.key !== '') {
        const needle = `CF_${existing.key}`;
        const rows = await c.env.DB.prepare(`SELECT id, name, script FROM components`)
          .all<{ id: string; name: string; script: string | null }>();
        const referencing = rows.results.filter(r => r.script?.includes(needle));
        if (referencing.length > 0) {
          return c.json({
            error: `Can't change key: still referenced by ${referencing.length} component${referencing.length === 1 ? '' : 's'} (${referencing.map(r => r.name).join(', ')}). Remove the reference${referencing.length === 1 ? '' : 's'} first.`,
            components: referencing.map(r => ({ id: r.id, name: r.name })),
          }, 409);
        }
      }
      if (newKey !== '') {
        const dup = await db.select({ id: schema.customFields.id }).from(schema.customFields)
          .where(and(eq(schema.customFields.key, newKey), ne(schema.customFields.id, id))).get();
        if (dup) return c.json({ error: `a custom field with key "${newKey}" already exists` }, 409);
      }
      updates.key = newKey;
    }
  }

  if (Object.keys(updates).length === 0) return c.json({ error: 'no recognized fields to update' }, 400);

  await db.update(schema.customFields).set(updates).where(eq(schema.customFields.id, id));
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
