import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, inArray } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';
import { reconcileOrphanedAlerts, resolveAllOpenAlerts } from '../../lib/alerts';

const policies = new Hono<{ Bindings: Bindings }>();

type CheckType = 'disk_space' | 'offline' | 'cpu_usage' | 'memory_usage' | 'av_status' | 'file_size' | 'ping' | 'process' | 'service' | 'software';
type Priority  = 'critical' | 'high' | 'moderate' | 'low';

const VALID_CHECK_TYPES: CheckType[] = ['disk_space', 'offline', 'cpu_usage', 'memory_usage', 'av_status', 'file_size', 'ping', 'process', 'service', 'software'];
const VALID_PRIORITIES:  Priority[]  = ['critical', 'high', 'moderate', 'low'];

// Fetch policies + their monitors and Targets (Sites/Devices/Groups — see
// deviceMatchesPolicy in lib/alerts.ts for how the three are OR'd together)
// in a handful of queries, merge in TS.
async function listWithMonitors(
  db: ReturnType<typeof drizzle<typeof schema>>,
  scope?: 'global' | 'company',
) {
  const policiesList = scope
    ? await db.select().from(schema.policies).where(eq(schema.policies.scope, scope))
    : await db.select().from(schema.policies);

  if (!policiesList.length) return [];

  const ids = policiesList.map(p => p.id);
  const [monitors, sites, devices, groups] = await Promise.all([
    db.select().from(schema.policyMonitors).where(inArray(schema.policyMonitors.policyId, ids)),
    db.select().from(schema.policySites).where(inArray(schema.policySites.policyId, ids)),
    db.select().from(schema.policyDevices).where(inArray(schema.policyDevices.policyId, ids)),
    db.select().from(schema.policyGroups).where(inArray(schema.policyGroups.policyId, ids)),
  ]);

  return policiesList.map(p => ({
    ...p,
    monitors:  monitors.filter(m => m.policyId === p.id),
    siteIds:   sites.filter(s => s.policyId === p.id).map(s => s.tenantId),
    deviceIds: devices.filter(d => d.policyId === p.id).map(d => d.deviceId),
    groupIds:  groups.filter(g => g.policyId === p.id).map(g => g.groupId),
  }));
}

// Recomputed after every mutation of policy_sites/policy_devices/policy_groups
// — scope is derived (migration 0032), not directly user-set: 'global' when a
// policy has zero targets across all three tables, 'company' when it has 1+.
// Purely a display/tab-filtering convenience (GlobalPoliciesPage.vue's
// Global/Company tabs, DeviceDetailPage.vue's scope badge) — matching logic
// itself (deviceMatchesPolicy in lib/alerts.ts) reads the three tables
// directly and never looks at this column.
async function recomputePolicyScope(db: ReturnType<typeof drizzle<typeof schema>>, policyId: string): Promise<void> {
  const [sites, devices, groups] = await Promise.all([
    db.select().from(schema.policySites).where(eq(schema.policySites.policyId, policyId)),
    db.select().from(schema.policyDevices).where(eq(schema.policyDevices.policyId, policyId)),
    db.select().from(schema.policyGroups).where(eq(schema.policyGroups.policyId, policyId)),
  ]);
  const scope = (sites.length + devices.length + groups.length) === 0 ? 'global' : 'company';
  await db.update(schema.policies).set({ scope }).where(eq(schema.policies.id, policyId));
}

// ── GET /v1/admin/policies?scope=global|company ────────────────────────────────
policies.get('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);

  const db    = drizzle(c.env.DB, { schema });
  const scope = c.req.query('scope') as 'global' | 'company' | undefined;

  const result = await listWithMonitors(db, scope);
  return c.json(result);
});

// ── POST /v1/admin/policies ────────────────────────────────────────────────────
// Accepts optional clone_from: string to copy an existing policy + its monitors.
policies.post('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  const db  = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    name?:        string;
    description?: string | null;
    target_os?:   string[];
    target_class?: string[];
    clone_from?:  string; // existing policy id to copy from
  }>();

  let name        = body.name ?? '';
  let description = body.description ?? null;
  let targetOs    = body.target_os    ? JSON.stringify(body.target_os)    : '["windows","linux","macos"]';
  let targetClass = body.target_class ? JSON.stringify(body.target_class) : '["server","workstation","laptop"]';

  // If cloning, inherit fields (including Targets — Sites/Devices/Groups)
  // from source unless overridden. New, non-cloned policies always start
  // with zero targets (scope='global') — Targets are added via the nested
  // routes below, same "create empty, then POST nested items" convention as
  // every other nested resource in this codebase.
  let sourceMonitors: (typeof schema.policyMonitors.$inferSelect)[] = [];
  let sourceSites:    (typeof schema.policySites.$inferSelect)[]    = [];
  let sourceDevices:  (typeof schema.policyDevices.$inferSelect)[]  = [];
  let sourceGroups:   (typeof schema.policyGroups.$inferSelect)[]   = [];
  if (body.clone_from) {
    const source = await db.select().from(schema.policies)
      .where(eq(schema.policies.id, body.clone_from)).get();
    if (!source) return c.json({ error: 'clone_from policy not found' }, 404);

    if (!body.name)        name        = source.name;
    if (!body.description) description = source.description;
    if (!body.target_os)    targetOs    = source.targetOs;
    if (!body.target_class) targetClass = source.targetClass;

    [sourceMonitors, sourceSites, sourceDevices, sourceGroups] = await Promise.all([
      db.select().from(schema.policyMonitors).where(eq(schema.policyMonitors.policyId, source.id)),
      db.select().from(schema.policySites).where(eq(schema.policySites.policyId, source.id)),
      db.select().from(schema.policyDevices).where(eq(schema.policyDevices.policyId, source.id)),
      db.select().from(schema.policyGroups).where(eq(schema.policyGroups.policyId, source.id)),
    ]);
  }

  if (!name) return c.json({ error: 'name is required' }, 400);

  const id = crypto.randomUUID();
  await db.insert(schema.policies).values({
    id, name, description,
    scope: 'global', companyId: null, // derived; recomputePolicyScope corrects below if targets were cloned
    enabled: true,
    targetOs, targetClass,
    createdAt: now, updatedAt: now,
  });

  // Copy monitors + Targets when cloning
  if (sourceMonitors.length) {
    await Promise.all(sourceMonitors.map(m =>
      db.insert(schema.policyMonitors).values({
        id:                      crypto.randomUUID(),
        policyId:                id,
        checkType:               m.checkType,
        enabled:                 m.enabled,
        config:                  m.config,
        alertPriority:           m.alertPriority,
        sustainedMinutes:        m.sustainedMinutes,
        autoResolve:             m.autoResolve,
        autoResolveAfterMinutes: m.autoResolveAfterMinutes,
        createdAt:               now,
      })
    ));
  }
  if (sourceSites.length) {
    await Promise.all(sourceSites.map(s =>
      db.insert(schema.policySites).values({ policyId: id, tenantId: s.tenantId, createdAt: now })));
  }
  if (sourceDevices.length) {
    await Promise.all(sourceDevices.map(d =>
      db.insert(schema.policyDevices).values({ policyId: id, deviceId: d.deviceId, createdAt: now })));
  }
  if (sourceGroups.length) {
    await Promise.all(sourceGroups.map(g =>
      db.insert(schema.policyGroups).values({ policyId: id, groupId: g.groupId, createdAt: now })));
  }
  if (sourceSites.length || sourceDevices.length || sourceGroups.length) {
    await recomputePolicyScope(db, id);
  }

  const result = await listWithMonitors(drizzle(c.env.DB, { schema }));
  const created = result.find(p => p.id === id);
  return c.json(created ?? { id }, 201);
});

// ── PATCH /v1/admin/policies/:id ──────────────────────────────────────────────
policies.patch('/:id', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  const db  = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const id  = c.req.param('id');

  const body = await c.req.json<{
    name?:        string;
    description?: string | null;
    enabled?:     boolean;
    target_os?:   string[];
    target_class?: string[];
  }>();

  const patch: Record<string, unknown> = { updatedAt: now };
  if (body.name        !== undefined) patch.name        = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.enabled     !== undefined) patch.enabled     = body.enabled;
  if (body.target_os   !== undefined) patch.targetOs    = JSON.stringify(body.target_os);
  if (body.target_class !== undefined) patch.targetClass = JSON.stringify(body.target_class);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.update(schema.policies).set(patch as any).where(eq(schema.policies.id, id));

  // Narrowing target_os/target_class or disabling can leave an alert open
  // forever for a device that no longer matches (nothing would ever
  // re-evaluate it again) — reconcile any open alerts under this policy now.
  const monitorIds = (await db.select({ id: schema.policyMonitors.id })
    .from(schema.policyMonitors)
    .where(eq(schema.policyMonitors.policyId, id))).map(m => m.id);
  await reconcileOrphanedAlerts(c.env.DB, monitorIds, now);

  return c.json({ ok: true });
});

// ── DELETE /v1/admin/policies/:id ─────────────────────────────────────────────
policies.delete('/:id', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  const monitorIds = (await db.select({ id: schema.policyMonitors.id })
    .from(schema.policyMonitors)
    .where(eq(schema.policyMonitors.policyId, id))).map(m => m.id);
  await resolveAllOpenAlerts(c.env.DB, monitorIds, now);

  await db.delete(schema.policies).where(eq(schema.policies.id, id));
  return c.json({ ok: true });
});

// ── GET /v1/admin/policies/:id/monitors ───────────────────────────────────────
policies.get('/:id/monitors', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const monitors = await db.select().from(schema.policyMonitors)
    .where(eq(schema.policyMonitors.policyId, c.req.param('id')));
  return c.json(monitors);
});

// ── POST /v1/admin/policies/:id/monitors ──────────────────────────────────────
policies.post('/:id/monitors', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  const db  = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    check_type:                CheckType;
    config:                    Record<string, unknown>;
    alert_priority?:           Priority;
    sustained_minutes?:        number;
    check_interval_minutes?:  number;
    auto_resolve?:             boolean;
    auto_resolve_after_minutes?: number;
  }>();

  if (!VALID_CHECK_TYPES.includes(body.check_type))
    return c.json({ error: 'invalid check_type' }, 400);

  const priority = body.alert_priority && VALID_PRIORITIES.includes(body.alert_priority)
    ? body.alert_priority : 'high';

  const id = crypto.randomUUID();
  await db.insert(schema.policyMonitors).values({
    id,
    policyId:                c.req.param('id'),
    checkType:               body.check_type,
    enabled:                 true,
    config:                  JSON.stringify(body.config ?? {}),
    alertPriority:           priority,
    sustainedMinutes:        body.sustained_minutes        ?? 5,
    checkIntervalMinutes:    body.check_interval_minutes   ?? 1,
    autoResolve:             body.auto_resolve             ?? true,
    autoResolveAfterMinutes: body.auto_resolve_after_minutes ?? 60,
    createdAt:               now,
  });

  return c.json({ monitor_id: id }, 201);
});

// ── PATCH /v1/admin/policies/:id/monitors/:mid ────────────────────────────────
policies.patch('/:id/monitors/:mid', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  const db  = drizzle(c.env.DB, { schema });
  const mid = c.req.param('mid');
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    enabled?:                boolean;
    config?:                 Record<string, unknown>;
    alert_priority?:         Priority;
    sustained_minutes?:      number;
    check_interval_minutes?: number;
    auto_resolve?:           boolean;
    auto_resolve_after_minutes?: number;
  }>();

  const patch: Record<string, unknown> = {};
  if (body.enabled                    !== undefined) patch.enabled                  = body.enabled;
  if (body.config                     !== undefined) patch.config                   = JSON.stringify(body.config);
  if (body.alert_priority             !== undefined) patch.alertPriority            = body.alert_priority;
  if (body.sustained_minutes          !== undefined) patch.sustainedMinutes         = body.sustained_minutes;
  if (body.check_interval_minutes     !== undefined) patch.checkIntervalMinutes     = body.check_interval_minutes;
  if (body.auto_resolve               !== undefined) patch.autoResolve              = body.auto_resolve;
  if (body.auto_resolve_after_minutes !== undefined) patch.autoResolveAfterMinutes  = body.auto_resolve_after_minutes;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.update(schema.policyMonitors).set(patch as any).where(eq(schema.policyMonitors.id, mid));

  // Disabling a monitor (or its parent policy elsewhere) can leave an alert
  // open forever for a device that no longer matches — reconcile now.
  await reconcileOrphanedAlerts(c.env.DB, [mid], now);

  return c.json({ ok: true });
});

// ── DELETE /v1/admin/policies/:id/monitors/:mid ───────────────────────────────
policies.delete('/:id/monitors/:mid', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  const db  = drizzle(c.env.DB, { schema });
  const mid = c.req.param('mid');
  const now = Math.floor(Date.now() / 1000);

  await resolveAllOpenAlerts(c.env.DB, [mid], now);
  await db.delete(schema.policyMonitors).where(eq(schema.policyMonitors.id, mid));
  return c.json({ ok: true });
});

// ── Targets: Sites / Devices / Device Groups (nested, independent
// lifecycles — mirrors components.ts's /:id/sites). All three are OR'd
// together, not ANDed — see deviceMatchesPolicy in lib/alerts.ts. Every
// mutation below recomputes the derived `scope` display column (see
// recomputePolicyScope above). ─────────────────────────────────────────────

policies.get('/:id/groups', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);

  const result = await c.env.DB.prepare(
    `SELECT pg.group_id, g.name FROM policy_groups pg
     JOIN device_groups g ON g.id = pg.group_id
     WHERE pg.policy_id = ? ORDER BY g.name ASC`
  ).bind(c.req.param('id')).all<{ group_id: string; name: string }>();

  return c.json(result.results.map(r => ({ groupId: r.group_id, name: r.name })));
});

policies.post('/:id/groups', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);
  const policyId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{ group_id?: string }>();
  if (!body.group_id) return c.json({ error: 'group_id is required' }, 400);

  const group = await c.env.DB.prepare(`SELECT id FROM device_groups WHERE id = ?`).bind(body.group_id).first();
  if (!group) return c.json({ error: 'group not found' }, 404);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO policy_groups (policy_id, group_id, created_at) VALUES (?, ?, ?)`
  ).bind(policyId, body.group_id, now).run();
  await recomputePolicyScope(drizzle(c.env.DB, { schema }), policyId);

  // Adding a target only ever widens eligibility (OR'd with whatever else
  // was already required) — no reconcile needed, unlike the narrowing
  // DELETE below.
  return c.json({ ok: true }, 201);
});

policies.delete('/:id/groups/:groupId', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);
  const policyId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `DELETE FROM policy_groups WHERE policy_id = ? AND group_id = ?`
  ).bind(policyId, c.req.param('groupId')).run();
  await recomputePolicyScope(drizzle(c.env.DB, { schema }), policyId);

  // Removing a target can narrow eligibility (a device that only qualified
  // via this one target may now be orphaned) — reconcile.
  const monitorIds = (await c.env.DB.prepare(
    `SELECT id FROM policy_monitors WHERE policy_id = ?`
  ).bind(policyId).all<{ id: string }>()).results.map(m => m.id);
  await reconcileOrphanedAlerts(c.env.DB, monitorIds, now);

  return c.json({ ok: true });
});

policies.get('/:id/sites', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);

  const result = await c.env.DB.prepare(
    `SELECT ps.tenant_id, t.name FROM policy_sites ps
     JOIN tenants t ON t.id = ps.tenant_id
     WHERE ps.policy_id = ? ORDER BY t.name ASC`
  ).bind(c.req.param('id')).all<{ tenant_id: string; name: string }>();

  return c.json(result.results.map(r => ({ tenantId: r.tenant_id, name: r.name })));
});

policies.post('/:id/sites', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);
  const policyId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{ tenant_id?: string }>();
  if (!body.tenant_id) return c.json({ error: 'tenant_id is required' }, 400);

  const tenant = await c.env.DB.prepare(`SELECT id FROM tenants WHERE id = ?`).bind(body.tenant_id).first();
  if (!tenant) return c.json({ error: 'site not found' }, 404);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO policy_sites (policy_id, tenant_id, created_at) VALUES (?, ?, ?)`
  ).bind(policyId, body.tenant_id, now).run();
  await recomputePolicyScope(drizzle(c.env.DB, { schema }), policyId);

  // Adding a target only ever widens eligibility — no reconcile needed.
  return c.json({ ok: true }, 201);
});

policies.delete('/:id/sites/:tenantId', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);
  const policyId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `DELETE FROM policy_sites WHERE policy_id = ? AND tenant_id = ?`
  ).bind(policyId, c.req.param('tenantId')).run();
  await recomputePolicyScope(drizzle(c.env.DB, { schema }), policyId);

  // Removing a target can narrow eligibility — reconcile.
  const monitorIds = (await c.env.DB.prepare(
    `SELECT id FROM policy_monitors WHERE policy_id = ?`
  ).bind(policyId).all<{ id: string }>()).results.map(m => m.id);
  await reconcileOrphanedAlerts(c.env.DB, monitorIds, now);

  return c.json({ ok: true });
});

policies.get('/:id/devices', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);

  const result = await c.env.DB.prepare(
    `SELECT pd.device_id, d.hostname, t.name AS tenant_name FROM policy_devices pd
     JOIN devices d ON d.id = pd.device_id
     JOIN tenants t ON t.id = d.tenant_id
     WHERE pd.policy_id = ? ORDER BY d.hostname ASC`
  ).bind(c.req.param('id')).all<{ device_id: string; hostname: string | null; tenant_name: string }>();

  return c.json(result.results.map(r => ({ deviceId: r.device_id, hostname: r.hostname, tenantName: r.tenant_name })));
});

policies.post('/:id/devices', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);
  const policyId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{ device_id?: string }>();
  if (!body.device_id) return c.json({ error: 'device_id is required' }, 400);

  const device = await c.env.DB.prepare(`SELECT id FROM devices WHERE id = ?`).bind(body.device_id).first();
  if (!device) return c.json({ error: 'device not found' }, 404);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO policy_devices (policy_id, device_id, created_at) VALUES (?, ?, ?)`
  ).bind(policyId, body.device_id, now).run();
  await recomputePolicyScope(drizzle(c.env.DB, { schema }), policyId);

  // Adding a target only ever widens eligibility — no reconcile needed.
  return c.json({ ok: true }, 201);
});

policies.delete('/:id/devices/:deviceId', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);
  const policyId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `DELETE FROM policy_devices WHERE policy_id = ? AND device_id = ?`
  ).bind(policyId, c.req.param('deviceId')).run();
  await recomputePolicyScope(drizzle(c.env.DB, { schema }), policyId);

  // Removing a target can narrow eligibility — reconcile.
  const monitorIds = (await c.env.DB.prepare(
    `SELECT id FROM policy_monitors WHERE policy_id = ?`
  ).bind(policyId).all<{ id: string }>()).results.map(m => m.id);
  await reconcileOrphanedAlerts(c.env.DB, monitorIds, now);

  return c.json({ ok: true });
});

export default policies;
