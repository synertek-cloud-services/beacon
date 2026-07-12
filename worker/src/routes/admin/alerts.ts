import { Hono } from 'hono';
import type { Bindings } from '../../index';

const alerts = new Hono<{ Bindings: Bindings }>();

function requireAdmin(auth: string | undefined, secret: string): boolean {
  return auth === `Bearer ${secret}`;
}

// GET /v1/admin/alerts?status=active|all
// Returns alert states joined with device, tenant, and definition info.
// Default: only currently-alerting states (status=active).
alerts.get('/', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const showAll = c.req.query('status') === 'all';

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
      def.id          AS definition_id,
      def.check_type,
      def.threshold,
      def.consecutive_failures_required,
      def.device_class AS definition_device_class
    FROM alert_state s
    JOIN devices d          ON s.device_id          = d.id
    JOIN tenants t          ON d.tenant_id           = t.id
    JOIN alert_definitions def ON s.alert_definition_id = def.id
    ${showAll ? '' : 'WHERE s.is_alerting = 1'}
    ORDER BY s.alerted_at DESC
    LIMIT 500
  `;

  const rows = await c.env.DB.prepare(sql).all();
  return c.json(rows.results);
});

export default alerts;
