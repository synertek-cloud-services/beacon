import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireAdmin } from '../../lib/auth';

const webhooks = new Hono<{ Bindings: Bindings }>();

webhooks.get('/', async (c) => {
  if (!(await requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  const tenantId = c.req.query('tenant_id');
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const rows = await db.select()
    .from(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.tenantId, tenantId));

  return c.json(rows);
});

webhooks.post('/', async (c) => {
  if (!(await requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{ tenant_id: string; url: string }>();
  const id = crypto.randomUUID();

  await db.insert(schema.webhookEndpoints).values({
    id,
    tenantId: body.tenant_id,
    url: body.url,
    createdAt: now,
  });

  return c.json({ webhook_id: id });
});

webhooks.delete('/:id', async (c) => {
  if (!(await requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.id, c.req.param('id')));
  return c.json({ ok: true });
});

export default webhooks;
