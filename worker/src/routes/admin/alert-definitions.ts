import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';

const alertDefs = new Hono<{ Bindings: Bindings }>();

function requireAdmin(auth: string | undefined, secret: string): boolean {
  return auth === `Bearer ${secret}`;
}

type CheckType = 'disk_space' | 'offline' | 'cpu_usage' | 'memory_usage';
type Priority  = 'critical' | 'high' | 'moderate' | 'low';

// GET /v1/admin/alert-definitions?tenant_id=<id>   → per-tenant list
// GET /v1/admin/alert-definitions                   → all definitions with tenant name
alertDefs.get('/', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  const tenantId = c.req.query('tenant_id');

  if (tenantId) {
    const defs = await db.select()
      .from(schema.alertDefinitions)
      .where(eq(schema.alertDefinitions.tenantId, tenantId));
    return c.json(defs);
  }

  // Global view: join with tenants to include tenant name
  const rows = await c.env.DB.prepare(`
    SELECT ad.*, t.name AS tenant_name
    FROM alert_definitions ad
    JOIN tenants t ON ad.tenant_id = t.id
    ORDER BY t.name, ad.created_at DESC
  `).all();

  return c.json(rows.results);
});

alertDefs.post('/', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    tenant_id: string;
    device_id?: string;
    device_class?: 'server' | 'workstation' | 'laptop';
    check_type: CheckType;
    threshold: unknown;
    consecutive_failures_required?: number;
    priority?: Priority;
  }>();

  const validTypes: CheckType[] = ['disk_space', 'offline', 'cpu_usage', 'memory_usage'];
  if (!validTypes.includes(body.check_type)) {
    return c.json({ error: 'invalid check_type' }, 400);
  }

  const id = crypto.randomUUID();
  const validPriorities: Priority[] = ['critical', 'high', 'moderate', 'low'];
  const priority = body.priority && validPriorities.includes(body.priority) ? body.priority : 'high';

  await db.insert(schema.alertDefinitions).values({
    id,
    tenantId: body.tenant_id,
    deviceId: body.device_id ?? null,
    deviceClass: body.device_class ?? null,
    checkType: body.check_type,
    threshold: JSON.stringify(body.threshold),
    consecutiveFailuresRequired: body.consecutive_failures_required ?? 3,
    priority,
    createdAt: now,
  });

  return c.json({ definition_id: id });
});

alertDefs.delete('/:id', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.alertDefinitions)
    .where(eq(schema.alertDefinitions.id, c.req.param('id')));
  return c.json({ ok: true });
});

export default alertDefs;
