import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';

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

  const row = await drizzle(c.env.DB, { schema }).select()
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

  const db  = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const updates: Partial<typeof schema.hostSettings.$inferInsert> = { updatedAt: now };
  if (body.timezone !== undefined) updates.timezone = body.timezone;

  await db.update(schema.hostSettings).set(updates).where(eq(schema.hostSettings.id, 1));
  return c.json({ ok: true });
});

export default settings;
