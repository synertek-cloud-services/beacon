import { Hono } from 'hono';
import type { Bindings } from '../../index';
import { requireUser } from '../../lib/auth';
import { buildDashboardData } from '../../lib/dashboardData';

const dashboards = new Hono<{ Bindings: Bindings }>();

const WIDGET_TYPES = new Set([
  'device_summary', 'online_offline', 'os_distribution', 'class_distribution',
  'antivirus_status', 'offline_by_type', 'alerts_by_priority', 'recent_alerts',
]);
const TEMPLATES: Record<string, Array<{ type: string; x: number; y: number; w: number; h: number }>> = {
  blank: [],
  default: [
    { type: 'device_summary', x: 0, y: 0, w: 12, h: 7 }, { type: 'recent_alerts', x: 0, y: 7, w: 12, h: 14 },
    { type: 'online_offline', x: 0, y: 21, w: 4, h: 8 }, { type: 'os_distribution', x: 4, y: 21, w: 4, h: 8 },
    { type: 'class_distribution', x: 8, y: 21, w: 4, h: 8 }, { type: 'offline_by_type', x: 0, y: 29, w: 4, h: 8 },
    { type: 'antivirus_status', x: 4, y: 29, w: 4, h: 8 }, { type: 'alerts_by_priority', x: 8, y: 29, w: 4, h: 8 },
  ],
};

async function auth(c: any, min: 'readonly' | 'technician' | 'admin' = 'readonly') {
  return requireUser(c.req.header('Authorization'), c.env, min);
}
function validLayout(value: unknown): value is { x: number; y: number; w: number; h: number } {
  if (!value || typeof value !== 'object') return false;
  const { x, y, w, h } = value as Record<string, unknown>;
  return [x, y, w, h].every(Number.isInteger) && (x as number) >= 0 && (y as number) >= 0 &&
    (w as number) >= 1 && (w as number) <= 12 && (h as number) >= 1 && (h as number) <= 12 && (x as number) + (w as number) <= 12;
}
function dashboardRow(row: Record<string, unknown>) {
  return { id: row.id, name: row.name, sortOrder: row.sort_order, isHome: row.is_home === 1, createdAt: row.created_at, updatedAt: row.updated_at };
}
async function getDashboard(c: any, id: string) {
  return c.env.DB.prepare('SELECT * FROM dashboards WHERE id = ?').bind(id).first() as Promise<Record<string, unknown> | null>;
}
async function siteIds(c: any, id: string) {
  const result = await c.env.DB.prepare('SELECT tenant_id FROM dashboard_sites WHERE dashboard_id = ? ORDER BY tenant_id').bind(id).all() as D1Result<{ tenant_id: string }>;
  return result.results.map((row: { tenant_id: string }) => row.tenant_id);
}
async function dashboardDetail(c: any, id: string) {
  const dashboard = await getDashboard(c, id);
  if (!dashboard) return null;
  const [sites, widgets] = await Promise.all([
    siteIds(c, id),
    c.env.DB.prepare('SELECT * FROM dashboard_widgets WHERE dashboard_id = ? ORDER BY sort_order, grid_y, grid_x').bind(id).all() as Promise<D1Result<Record<string, unknown>>>,
  ]);
  return { ...dashboardRow(dashboard), siteIds: sites, widgets: widgets.results.map(w => ({
    id: w.id, type: w.type, title: w.title, config: w.config, x: w.grid_x, y: w.grid_y, w: w.grid_w, h: w.grid_h, sortOrder: w.sort_order,
  })) };
}

dashboards.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const result = await c.env.DB.prepare('SELECT * FROM dashboards ORDER BY sort_order, created_at').all() as D1Result<Record<string, unknown>>;
  return c.json(result.results.map(dashboardRow));
});

dashboards.post('/', async (c) => {
  if (!(await auth(c, 'admin'))) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ name?: string; template?: string }>();
  const name = body.name?.trim(); const template = body.template ?? 'default';
  if (!name) return c.json({ error: 'name is required' }, 400);
  if (!(template in TEMPLATES)) return c.json({ error: 'template must be default or blank' }, 400);
  const now = Math.floor(Date.now() / 1000), id = crypto.randomUUID();
  const count = await c.env.DB.prepare('SELECT count(*) AS count FROM dashboards').first() as { count: number } | null;
  const last = await c.env.DB.prepare('SELECT max(sort_order) AS sort_order FROM dashboards').first() as { sort_order: number | null } | null;
  const statements: D1PreparedStatement[] = [c.env.DB.prepare(
    'INSERT INTO dashboards (id, name, sort_order, is_home, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(id, name, (last?.sort_order ?? -1) + 1, count?.count === 0 ? 1 : 0, now, now)];
  for (const [sort, widget] of TEMPLATES[template].entries()) statements.push(c.env.DB.prepare(
    'INSERT INTO dashboard_widgets (id, dashboard_id, type, grid_x, grid_y, grid_w, grid_h, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), id, widget.type, widget.x, widget.y, widget.w, widget.h, sort, now, now));
  await c.env.DB.batch(statements);
  return c.json(await dashboardDetail(c, id), 201);
});

dashboards.get('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const detail = await dashboardDetail(c, c.req.param('id'));
  return detail ? c.json(detail) : c.json({ error: 'not found' }, 404);
});

dashboards.get('/:id/data', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id'); if (!(await getDashboard(c, id))) return c.json({ error: 'not found' }, 404);
  const savedScope = await siteIds(c, id);
  const companyId = c.req.query('company_id');
  // An explicit company context deliberately overrides the saved scope, matching
  // the rest of Beacon's company-context navigation.
  return c.json(await buildDashboardData(c.env.DB, companyId ? [companyId] : savedScope));
});

dashboards.patch('/:id', async (c) => {
  if (!(await auth(c, 'admin'))) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id'); if (!(await getDashboard(c, id))) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ name?: string; sortOrder?: number; isHome?: boolean; siteIds?: string[] }>();
  const now = Math.floor(Date.now() / 1000); const statements: D1PreparedStatement[] = [];
  if (body.name !== undefined) { if (!body.name.trim()) return c.json({ error: 'name is required' }, 400); statements.push(c.env.DB.prepare('UPDATE dashboards SET name = ?, updated_at = ? WHERE id = ?').bind(body.name.trim(), now, id)); }
  if (body.sortOrder !== undefined) { if (!Number.isInteger(body.sortOrder)) return c.json({ error: 'sortOrder must be an integer' }, 400); statements.push(c.env.DB.prepare('UPDATE dashboards SET sort_order = ?, updated_at = ? WHERE id = ?').bind(body.sortOrder, now, id)); }
  if (body.isHome) { statements.push(c.env.DB.prepare('UPDATE dashboards SET is_home = 0 WHERE is_home = 1'), c.env.DB.prepare('UPDATE dashboards SET is_home = 1, updated_at = ? WHERE id = ?').bind(now, id)); }
  if (body.siteIds !== undefined) {
    if (!Array.isArray(body.siteIds) || body.siteIds.some(value => typeof value !== 'string')) return c.json({ error: 'siteIds must be an array of IDs' }, 400);
    statements.push(c.env.DB.prepare('DELETE FROM dashboard_sites WHERE dashboard_id = ?').bind(id));
    for (const tenantId of [...new Set(body.siteIds)]) statements.push(c.env.DB.prepare('INSERT INTO dashboard_sites (dashboard_id, tenant_id, created_at) VALUES (?, ?, ?)').bind(id, tenantId, now));
  }
  if (!statements.length) return c.json({ error: 'nothing to update' }, 400);
  await c.env.DB.batch(statements); return c.json(await dashboardDetail(c, id));
});

dashboards.post('/:id/clone', async (c) => {
  if (!(await auth(c, 'admin'))) return c.json({ error: 'unauthorized' }, 401);
  const source = await dashboardDetail(c, c.req.param('id')); if (!source) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ name?: string }>(); const name = body.name?.trim() || `${source.name} copy`;
  const now = Math.floor(Date.now() / 1000), id = crypto.randomUUID();
  const last = await c.env.DB.prepare('SELECT max(sort_order) AS sort_order FROM dashboards').first() as { sort_order: number | null } | null;
  const statements: D1PreparedStatement[] = [c.env.DB.prepare('INSERT INTO dashboards (id, name, sort_order, is_home, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').bind(id, name, (last?.sort_order ?? -1) + 1, now, now)];
  for (const siteId of source.siteIds) statements.push(c.env.DB.prepare('INSERT INTO dashboard_sites (dashboard_id, tenant_id, created_at) VALUES (?, ?, ?)').bind(id, siteId, now));
  for (const widget of source.widgets) statements.push(c.env.DB.prepare('INSERT INTO dashboard_widgets (id, dashboard_id, type, title, config, grid_x, grid_y, grid_w, grid_h, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, widget.type, widget.title, widget.config, widget.x, widget.y, widget.w, widget.h, widget.sortOrder, now, now));
  await c.env.DB.batch(statements); return c.json(await dashboardDetail(c, id), 201);
});

dashboards.delete('/:id', async (c) => {
  if (!(await auth(c, 'admin'))) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id'); const target = await getDashboard(c, id); if (!target) return c.json({ error: 'not found' }, 404);
  const count = await c.env.DB.prepare('SELECT count(*) AS count FROM dashboards').first() as { count: number } | null;
  if ((count?.count ?? 0) <= 1) return c.json({ error: 'at least one dashboard is required' }, 409);
  const statements: D1PreparedStatement[] = [c.env.DB.prepare('DELETE FROM dashboards WHERE id = ?').bind(id)];
  if (target.is_home === 1) { const next = await c.env.DB.prepare('SELECT id FROM dashboards WHERE id != ? ORDER BY sort_order, created_at LIMIT 1').bind(id).first() as { id: string } | null; if (next) statements.push(c.env.DB.prepare('UPDATE dashboards SET is_home = 1 WHERE id = ?').bind(next.id)); }
  await c.env.DB.batch(statements); return c.json({ ok: true });
});

dashboards.post('/:id/widgets', async (c) => {
  if (!(await auth(c, 'admin'))) return c.json({ error: 'unauthorized' }, 401);
  const dashboardId = c.req.param('id'); if (!(await getDashboard(c, dashboardId))) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ type?: string; title?: string | null; layout?: unknown }>();
  if (!body.type || !WIDGET_TYPES.has(body.type)) return c.json({ error: 'unsupported widget type' }, 400);
  const nextRow = await c.env.DB.prepare('SELECT max(grid_y + grid_h) AS y FROM dashboard_widgets WHERE dashboard_id = ?').bind(dashboardId).first() as { y: number | null } | null;
  const layout = body.layout ?? { x: 0, y: nextRow?.y ?? 0, w: 4, h: 8 }; if (!validLayout(layout)) return c.json({ error: 'invalid widget layout' }, 400);
  const now = Math.floor(Date.now() / 1000), id = crypto.randomUUID(); const l = layout as { x: number; y: number; w: number; h: number };
  const last = await c.env.DB.prepare('SELECT max(sort_order) AS sort_order FROM dashboard_widgets WHERE dashboard_id = ?').bind(dashboardId).first() as { sort_order: number | null } | null;
  await c.env.DB.prepare('INSERT INTO dashboard_widgets (id, dashboard_id, type, title, grid_x, grid_y, grid_w, grid_h, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, dashboardId, body.type, body.title?.trim() || null, l.x, l.y, l.w, l.h, (last?.sort_order ?? -1) + 1, now, now).run();
  return c.json((await dashboardDetail(c, dashboardId))?.widgets.find(widget => widget.id === id), 201);
});

dashboards.patch('/:id/widgets/:widgetId', async (c) => {
  if (!(await auth(c, 'admin'))) return c.json({ error: 'unauthorized' }, 401);
  const dashboardId = c.req.param('id'), widgetId = c.req.param('widgetId');
  const body = await c.req.json<{ title?: string | null; layout?: unknown }>(); const now = Math.floor(Date.now() / 1000);
  const current = await c.env.DB.prepare('SELECT id FROM dashboard_widgets WHERE id = ? AND dashboard_id = ?').bind(widgetId, dashboardId).first(); if (!current) return c.json({ error: 'not found' }, 404);
  const statements: D1PreparedStatement[] = [];
  if ('title' in body) statements.push(c.env.DB.prepare('UPDATE dashboard_widgets SET title = ?, updated_at = ? WHERE id = ?').bind(body.title?.trim() || null, now, widgetId));
  if (body.layout !== undefined) { if (!validLayout(body.layout)) return c.json({ error: 'invalid widget layout' }, 400); const l = body.layout; statements.push(c.env.DB.prepare('UPDATE dashboard_widgets SET grid_x = ?, grid_y = ?, grid_w = ?, grid_h = ?, updated_at = ? WHERE id = ?').bind(l.x, l.y, l.w, l.h, now, widgetId)); }
  if (!statements.length) return c.json({ error: 'nothing to update' }, 400); await c.env.DB.batch(statements); return c.json({ ok: true });
});

dashboards.delete('/:id/widgets/:widgetId', async (c) => {
  if (!(await auth(c, 'admin'))) return c.json({ error: 'unauthorized' }, 401);
  const result = await c.env.DB.prepare('DELETE FROM dashboard_widgets WHERE id = ? AND dashboard_id = ?').bind(c.req.param('widgetId'), c.req.param('id')).run();
  return result.meta.changes ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
});

export default dashboards;
