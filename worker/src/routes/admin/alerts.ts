import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';

const alerts = new Hono<{ Bindings: Bindings }>();

function requireAdmin(auth: string | undefined, secret: string): boolean {
  return auth === `Bearer ${secret}`;
}

// GET /v1/admin/alerts?status=active|all&search=<text>
// Returns alert states joined with device, tenant, and definition info.
// Default: only currently-alerting states (status=active).
alerts.get('/', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const showAll  = c.req.query('status') === 'all';
  const search   = c.req.query('search')?.toLowerCase() ?? '';
  // Last 30 days threshold for "all" view
  const since30d = Math.floor(Date.now() / 1000) - 30 * 86400;

  const whereClause = showAll
    ? 'WHERE s.alerted_at IS NOT NULL AND s.alerted_at > ?'
    : 'WHERE s.is_alerting = 1';

  const sql = `
    SELECT
      s.id,
      s.is_alerting,
      s.consecutive_failures,
      s.alerted_at,
      s.resolved_at,
      s.updated_at,
      d.id   AS device_id,
      d.hostname,
      d.os_type,
      d.detected_class,
      d.override_class,
      t.id   AS tenant_id,
      t.name AS tenant_name,
      def.id              AS definition_id,
      def.check_type,
      def.threshold,
      def.priority,
      def.consecutive_failures_required,
      def.device_class    AS definition_device_class
    FROM alert_state s
    JOIN devices d           ON s.device_id           = d.id
    JOIN tenants t           ON d.tenant_id            = t.id
    JOIN alert_definitions def ON s.alert_definition_id = def.id
    ${whereClause}
    ORDER BY s.alerted_at DESC
    LIMIT 500
  `;

  const result = showAll
    ? await c.env.DB.prepare(sql).bind(since30d).all()
    : await c.env.DB.prepare(sql).all();

  let rows = result.results as Record<string, unknown>[];

  if (search) {
    rows = rows.filter(r =>
      (r.hostname as string | null)?.toLowerCase().includes(search) ||
      (r.tenant_name as string).toLowerCase().includes(search) ||
      (r.check_type as string).toLowerCase().includes(search),
    );
  }

  return c.json(rows);
});

// POST /v1/admin/alerts/:id/resolve — manually clear an active alert
alerts.post('/:id/resolve', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const db  = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const id  = c.req.param('id');

  const state = await db.select()
    .from(schema.alertState)
    .where(eq(schema.alertState.id, id))
    .get();

  if (!state) return c.json({ error: 'not found' }, 404);

  await db.update(schema.alertState)
    .set({
      isAlerting:          false,
      consecutiveFailures: 0,
      resolvedAt:          now,
      updatedAt:           now,
    })
    .where(eq(schema.alertState.id, id));

  return c.json({ ok: true });
});

export default alerts;
