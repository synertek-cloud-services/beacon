import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { getDb } from '../../lib/db';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';
import { FEATURE_KEYS, FEATURE_COLUMNS, getFeatures, featuresForced, invalidateFeatureCache, type FeatureKey } from '../../lib/features';

// Host-wide singleton settings -- currently just the Maintenance-Policy
// scheduling timezone (see host_settings, migration 0051). Mirrors
// email-settings.ts's singleton GET/PATCH shape.
const settings = new Hono<{ Bindings: Bindings }>();

// GET at readonly, not admin: the host timezone is non-sensitive metadata
// any authenticated user viewing a Maintenance Policy's schedule needs to
// render it meaningfully ("Weekly, Fri 8:00 PM, America/New_York") -- gating
// at admin would 401 a technician opening the Maintenance Policies list.
settings.get('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);

  const row = await getDb(c.env.DB).select()
    .from(schema.hostSettings).where(eq(schema.hostSettings.id, 1)).get();
  return c.json(row ?? { id: 1, timezone: 'UTC', updatedAt: 0 });
});

// PATCH stays admin -- matches every other settings-mutation route, and the
// Settings sidebar section itself is already admin-gated in App.vue.
settings.patch('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'admin')))
    return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ timezone?: string }>();
  if (body.timezone !== undefined) {
    // Intl.supportedValuesOf('timeZone') deliberately NOT used here -- it
    // enumerates canonical IANA zone names but omits "UTC" itself (a real
    // bug hit during this feature's own verification: the schema's seeded
    // default value would fail re-validation). Constructing a
    // DateTimeFormat with the value is the correct validity check --
    // accepts "UTC"/"GMT" and any real IANA name, throws on garbage.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: body.timezone });
    } catch {
      return c.json({ error: 'unrecognized IANA timezone' }, 400);
    }
  }

  const db  = getDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const updates: Partial<typeof schema.hostSettings.$inferInsert> = { updatedAt: now };
  if (body.timezone !== undefined) updates.timezone = body.timezone;

  await db.update(schema.hostSettings).set(updates).where(eq(schema.hostSettings.id, 1));
  return c.json({ ok: true });
});

// Opt-in feature switches -- see lib/features.ts. Readable by any signed-in
// user (the dashboard needs it to decide whether to show a feature or its
// "turned off" notice); only an admin can change them.
settings.get('/features', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);
  return c.json({ features: await getFeatures(c.env), forced: featuresForced(c.env) });
});

settings.patch('/features', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'admin')))
    return c.json({ error: 'unauthorized' }, 401);
  if (featuresForced(c.env)) return c.json({ error: 'Features are managed by the host and cannot be changed here.' }, 409);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const updates: Partial<typeof schema.hostSettings.$inferInsert> = { updatedAt: Math.floor(Date.now() / 1000) };
  for (const [key, value] of Object.entries(body)) {
    if (!(FEATURE_KEYS as readonly string[]).includes(key)) return c.json({ error: `unknown feature: ${key}` }, 400);
    if (typeof value !== 'boolean') return c.json({ error: `${key} must be a boolean` }, 400);
    (updates as Record<string, unknown>)[FEATURE_COLUMNS[key as FeatureKey]] = value;
  }

  await getDb(c.env.DB).update(schema.hostSettings).set(updates).where(eq(schema.hostSettings.id, 1));
  invalidateFeatureCache();
  return c.json({ features: await getFeatures(c.env), forced: false });
});

export default settings;
