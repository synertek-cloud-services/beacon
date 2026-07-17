import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';

const alerts = new Hono<{ Bindings: Bindings }>();

// GET /v1/admin/alerts?status=active|all&search=<text>&company_id=<id>&device_id=<id>
alerts.get('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const showAll   = c.req.query('status') === 'all';
  const search    = c.req.query('search')?.toLowerCase() ?? '';
  const companyId = c.req.query('company_id');
  const deviceId  = c.req.query('device_id');
  const since30d  = Math.floor(Date.now() / 1000) - 30 * 86400;

  const params: (string | number)[] = [];
  let whereClause = showAll
    ? 'WHERE s.alerted_at IS NOT NULL AND s.alerted_at > ?'
    : 'WHERE s.is_alerting = 1';
  if (showAll) params.push(since30d);
  if (companyId) {
    whereClause += ' AND t.id = ?';
    params.push(companyId);
  }
  if (deviceId) {
    whereClause += ' AND s.device_id = ?';
    params.push(deviceId);
  }

  const sql = `
    SELECT
      s.id,
      s.is_alerting,
      s.condition_first_seen,
      s.alerted_at,
      s.resolved_at,
      s.acknowledged_at,
      s.acknowledged_by,
      s.updated_at,
      d.id   AS device_id,
      d.hostname,
      d.os_type,
      d.detected_class,
      d.override_class,
      t.id   AS tenant_id,
      t.name AS tenant_name,
      pm.id             AS monitor_id,
      pm.check_type,
      pm.config,
      pm.alert_priority AS priority,
      pm.sustained_minutes,
      p.id   AS policy_id,
      p.name AS policy_name,
      p.scope AS policy_scope
    FROM alert_state s
    JOIN devices d          ON s.device_id          = d.id
    JOIN tenants t          ON d.tenant_id           = t.id
    JOIN policy_monitors pm ON s.policy_monitor_id   = pm.id
    JOIN policies p         ON pm.policy_id          = p.id
    ${whereClause}
    ORDER BY s.alerted_at DESC
    LIMIT 500
  `;

  const result = await c.env.DB.prepare(sql).bind(...params).all();

  let rows = result.results as Record<string, unknown>[];

  if (search) {
    rows = rows.filter(r =>
      (r.hostname    as string | null)?.toLowerCase().includes(search) ||
      (r.tenant_name as string).toLowerCase().includes(search)         ||
      (r.check_type  as string).toLowerCase().includes(search)         ||
      (r.policy_name as string).toLowerCase().includes(search),
    );
  }

  return c.json(rows);
});

// POST /v1/admin/alerts/:id/resolve — manually clear an active alert
alerts.post('/:id/resolve', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician'))) {
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
      isAlerting:         false,
      conditionFirstSeen: null,
      resolvedAt:         now,
      updatedAt:          now,
    })
    .where(eq(schema.alertState.id, id));

  return c.json({ ok: true });
});

// POST /v1/admin/alerts/:id/acknowledge — mark an alert as seen without resolving it
alerts.post('/:id/acknowledge', async (c) => {
  const user = await requireUser(c.req.header('Authorization'), c.env, 'technician');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const db  = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const id  = c.req.param('id');

  const state = await db.select()
    .from(schema.alertState)
    .where(eq(schema.alertState.id, id))
    .get();

  if (!state) return c.json({ error: 'not found' }, 404);

  const acknowledgedBy = user.displayName ?? user.email ?? 'Admin';

  await db.update(schema.alertState)
    .set({ acknowledgedAt: now, acknowledgedBy, updatedAt: now })
    .where(eq(schema.alertState.id, id));

  return c.json({ ok: true });
});

export default alerts;
