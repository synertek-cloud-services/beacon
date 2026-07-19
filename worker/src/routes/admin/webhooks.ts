import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';

// Global, not per-company -- the hoster's own team reads alerts, not the
// client company being monitored. See worker/src/lib/alerts.ts's
// fireWebhooks() for where these actually fire. Settings-area config, so
// admin-only, same tier as email-settings.ts/notification-emails.ts.
const webhooks = new Hono<{ Bindings: Bindings }>();

webhooks.get('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'admin'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.webhookEndpoints);
  return c.json(rows);
});

webhooks.post('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'admin'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{ url?: string }>();
  if (!body.url?.trim()) return c.json({ error: 'url is required' }, 400);
  const id = crypto.randomUUID();

  await db.insert(schema.webhookEndpoints).values({
    id,
    url: body.url.trim(),
    createdAt: now,
  });

  return c.json({ id }, 201);
});

webhooks.patch('/:id', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'admin'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json<{ enabled?: boolean; url?: string }>();
  const updates: Partial<typeof schema.webhookEndpoints.$inferInsert> = {};
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.url !== undefined) {
    if (!body.url.trim()) return c.json({ error: 'url cannot be empty' }, 400);
    updates.url = body.url.trim();
  }
  if (Object.keys(updates).length === 0) return c.json({ error: 'nothing to update' }, 400);

  await db.update(schema.webhookEndpoints).set(updates).where(eq(schema.webhookEndpoints.id, c.req.param('id')));
  return c.json({ ok: true });
});

webhooks.delete('/:id', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'admin'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.id, c.req.param('id')));
  return c.json({ ok: true });
});

export default webhooks;
