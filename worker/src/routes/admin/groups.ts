import { Hono } from 'hono';
import type { Bindings } from '../../index';
import { requireUser, type Role } from '../../lib/auth';
import { reconcileOrphanedAlerts } from '../../lib/alerts';

const adminGroups = new Hono<{ Bindings: Bindings }>();

function auth(c: any, minRole: Role = 'readonly') {
  return requireUser(c.req.header('Authorization'), c.env, minRole);
}

function uid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// Device Groups are operational targeting infrastructure for Jobs/Policies
// (same tier as editing a policy or creating a job) -- not Settings-area
// config like Custom Field definitions or SSO providers, so mutations are
// technician, not admin-only.

// GET / — list groups with member_count and device_ids (via group_concat,
// same subquery convention as tenants.ts's device_count) -- deviceIds lets
// JobFormPage's target flyout compute an accurate deduped device count
// across multiple selected groups without an extra request per group.
adminGroups.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const result = await c.env.DB.prepare(`
    SELECT
      g.id, g.name, g.description, g.created_at, g.updated_at,
      (SELECT count(*) FROM device_group_members WHERE group_id = g.id) AS member_count,
      (SELECT group_concat(device_id) FROM device_group_members WHERE group_id = g.id) AS device_ids
    FROM device_groups g
    ORDER BY g.name ASC
  `).all<{ id: string; name: string; description: string | null; created_at: number; updated_at: number; member_count: number; device_ids: string | null }>();

  return c.json(result.results.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    memberCount: r.member_count,
    deviceIds: r.device_ids ? r.device_ids.split(',') : [],
  })));
});

// GET /:id — detail, including deviceIds so the dashboard can compute target
// counts (e.g. JobFormPage's resolvedDeviceCount) without an extra round trip
adminGroups.get('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');

  const group = await c.env.DB.prepare(
    `SELECT id, name, description, created_at, updated_at FROM device_groups WHERE id = ?`
  ).bind(id).first<{ id: string; name: string; description: string | null; created_at: number; updated_at: number }>();
  if (!group) return c.json({ error: 'not found' }, 404);

  const members = await c.env.DB.prepare(
    `SELECT device_id FROM device_group_members WHERE group_id = ?`
  ).bind(id).all<{ device_id: string }>();

  return c.json({
    id: group.id,
    name: group.name,
    description: group.description,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
    memberCount: members.results.length,
    deviceIds: members.results.map(m => m.device_id),
  });
});

// POST / — create a group
adminGroups.post('/', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ name?: string; description?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const id = uid();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO device_groups (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, name, body.description?.trim() || null, now, now).run();

  return c.json({ id }, 201);
});

// PATCH /:id — rename / update description
adminGroups.patch('/:id', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(`SELECT id FROM device_groups WHERE id = ?`).bind(id).first();
  if (!existing) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<{ name?: string; description?: string }>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return c.json({ error: 'name cannot be empty' }, 400);
    sets.push('name = ?'); vals.push(name);
  }
  if (body.description !== undefined) { sets.push('description = ?'); vals.push(body.description.trim() || null); }
  if (sets.length === 0) return c.json({ error: 'no recognized fields to update' }, 400);

  sets.push('updated_at = ?'); vals.push(Math.floor(Date.now() / 1000));
  vals.push(id);
  await c.env.DB.prepare(`UPDATE device_groups SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

// DELETE /:id — cascades device_group_members + policy_groups rows
adminGroups.delete('/:id', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  await c.env.DB.prepare(`DELETE FROM device_groups WHERE id = ?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ── Members (nested, independent lifecycle — mirrors component_sites) ───────

adminGroups.get('/:id/members', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const result = await c.env.DB.prepare(`
    SELECT d.id AS device_id, d.hostname, t.name AS tenant_name
    FROM device_group_members m
    JOIN devices d ON d.id = m.device_id
    JOIN tenants t ON t.id = d.tenant_id
    WHERE m.group_id = ?
    ORDER BY d.hostname ASC
  `).bind(c.req.param('id')).all<{ device_id: string; hostname: string | null; tenant_name: string }>();

  return c.json(result.results.map(r => ({ deviceId: r.device_id, hostname: r.hostname, tenantName: r.tenant_name })));
});

adminGroups.post('/:id/members', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const groupId = c.req.param('id');

  const group = await c.env.DB.prepare(`SELECT id FROM device_groups WHERE id = ?`).bind(groupId).first();
  if (!group) return c.json({ error: 'group not found' }, 404);

  const body = await c.req.json<{ device_id?: string }>();
  if (!body.device_id) return c.json({ error: 'device_id is required' }, 400);

  const device = await c.env.DB.prepare(`SELECT id FROM devices WHERE id = ?`).bind(body.device_id).first();
  if (!device) return c.json({ error: 'device not found' }, 404);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO device_group_members (group_id, device_id, created_at) VALUES (?, ?, ?)`
  ).bind(groupId, body.device_id, Math.floor(Date.now() / 1000)).run();

  return c.json({ ok: true }, 201);
});

// POST /:id/members/bulk — for DevicesPage's bulk "Add to Group" action, one
// round trip instead of N individual POSTs
adminGroups.post('/:id/members/bulk', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const groupId = c.req.param('id');

  const group = await c.env.DB.prepare(`SELECT id FROM device_groups WHERE id = ?`).bind(groupId).first();
  if (!group) return c.json({ error: 'group not found' }, 404);

  const body = await c.req.json<{ device_ids?: string[] }>();
  const deviceIds = body.device_ids ?? [];
  if (deviceIds.length === 0) return c.json({ error: 'device_ids is required' }, 400);

  const now = Math.floor(Date.now() / 1000);
  await Promise.all(deviceIds.map(deviceId =>
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO device_group_members (group_id, device_id, created_at) VALUES (?, ?, ?)`
    ).bind(groupId, deviceId, now).run()
  ));

  return c.json({ ok: true, added: deviceIds.length });
});

// DELETE /:id/members/:deviceId — a device leaving a group can make it
// ineligible for a group-scoped policy it was previously alerting under, so
// reconcile any now-orphaned open alerts (same pattern policies.ts already
// uses when target_os/target_class narrows).
adminGroups.delete('/:id/members/:deviceId', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const groupId = c.req.param('id');
  const deviceId = c.req.param('deviceId');

  await c.env.DB.prepare(
    `DELETE FROM device_group_members WHERE group_id = ? AND device_id = ?`
  ).bind(groupId, deviceId).run();

  const affected = await c.env.DB.prepare(`
    SELECT pm.id FROM policy_monitors pm
    JOIN policy_groups pg ON pg.policy_id = pm.policy_id
    WHERE pg.group_id = ?
  `).bind(groupId).all<{ id: string }>();

  if (affected.results.length > 0) {
    await reconcileOrphanedAlerts(c.env.DB, affected.results.map(r => r.id), Math.floor(Date.now() / 1000));
  }

  return c.json({ ok: true });
});

export default adminGroups;
