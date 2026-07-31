import { Hono } from 'hono';
import type { Bindings } from '../../index';
import { requireUser } from '../../lib/auth';
import { manuallyResolveAlert } from '../../lib/alerts';

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
      s.updated_at,
      d.id   AS device_id,
      d.hostname,
      d.os_type,
      d.detected_class,
      d.override_class,
      t.id   AS company_id,
      t.name AS company_name,
      pm.id             AS monitor_id,
      pm.check_type,
      pm.config,
      COALESCE(s.alert_priority, pm.alert_priority) AS priority,
      pm.sustained_minutes,
      p.id   AS policy_id,
      p.name AS policy_name,
      p.scope AS policy_scope
    FROM alert_state s
    JOIN devices d          ON s.device_id          = d.id
    JOIN companies t          ON d.company_id           = t.id
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
      (r.company_name as string).toLowerCase().includes(search)         ||
      (r.check_type  as string).toLowerCase().includes(search)         ||
      (r.policy_name as string).toLowerCase().includes(search),
    );
  }

  return c.json(rows);
});

// GET /v1/admin/alerts/:id — fetch a single alert by id
alerts.get('/:id', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const id = c.req.param('id');
  const sql = `
    SELECT
      s.id,
      s.is_alerting,
      s.condition_first_seen,
      s.alerted_at,
      s.resolved_at,
      s.updated_at,
      d.id   AS device_id,
      d.hostname,
      d.os_type,
      d.detected_class,
      d.override_class,
      t.id   AS company_id,
      t.name AS company_name,
      pm.id             AS monitor_id,
      pm.check_type,
      pm.config,
      COALESCE(s.alert_priority, pm.alert_priority) AS priority,
      pm.sustained_minutes,
      p.id   AS policy_id,
      p.name AS policy_name,
      p.scope AS policy_scope
    FROM alert_state s
    JOIN devices d          ON s.device_id          = d.id
    JOIN companies t          ON d.company_id           = t.id
    JOIN policy_monitors pm ON s.policy_monitor_id   = pm.id
    JOIN policies p         ON pm.policy_id          = p.id
    WHERE s.id = ?
  `;

  const result = await c.env.DB.prepare(sql).bind(id).first();
  if (!result) return c.json({ error: 'not found' }, 404);
  return c.json(result);
});

// POST /v1/admin/alerts/:id/resolve — manually clear an active alert. Fires
// the same alert.resolved webhook/email as auto-resolve does (gated by the
// monitor's notifyWebhook/notifyEmail flags) — see manuallyResolveAlert in
// lib/alerts.ts.
alerts.post('/:id/resolve', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const id  = c.req.param('id');

  const found = await manuallyResolveAlert(c.env.DB, c.env, id, now);
  if (!found) return c.json({ error: 'not found' }, 404);

  return c.json({ ok: true });
});

export default alerts;
