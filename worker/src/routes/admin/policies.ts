import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';

const policies = new Hono<{ Bindings: Bindings }>();

function requireAdmin(auth: string | undefined, secret: string): boolean {
  return auth === `Bearer ${secret}`;
}

type CheckType = 'disk_space' | 'offline' | 'cpu_usage' | 'memory_usage' | 'av_status' | 'file_size' | 'ping' | 'process' | 'service' | 'software';
type Priority  = 'critical' | 'high' | 'moderate' | 'low';

const VALID_CHECK_TYPES: CheckType[] = ['disk_space', 'offline', 'cpu_usage', 'memory_usage', 'av_status', 'file_size', 'ping', 'process', 'service', 'software'];
const VALID_PRIORITIES:  Priority[]  = ['critical', 'high', 'moderate', 'low'];

// Fetch policies + their monitors in two queries, merge in TS
async function listWithMonitors(
  db: ReturnType<typeof drizzle<typeof schema>>,
  whereFilter?: Parameters<typeof db.select>[0],
  scope?: 'global' | 'company',
  companyId?: string,
) {
  let q = db.select().from(schema.policies);
  const conditions = [];
  if (scope)      conditions.push(eq(schema.policies.scope, scope));
  if (companyId)  conditions.push(eq(schema.policies.companyId, companyId));
  if (!companyId && !scope) { /* no filter */ }

  const policiesList = conditions.length
    ? await q.where(conditions.length === 1 ? conditions[0] : and(...conditions))
    : await q;

  if (!policiesList.length) return [];

  const ids = policiesList.map(p => p.id);
  const monitors = await db.select()
    .from(schema.policyMonitors)
    .where(inArray(schema.policyMonitors.policyId, ids));

  return policiesList.map(p => ({
    ...p,
    monitors: monitors.filter(m => m.policyId === p.id),
  }));
}

// ── GET /v1/admin/policies?scope=global|company&company_id=<id> ───────────────
policies.get('/', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))
    return c.json({ error: 'unauthorized' }, 401);

  const db        = drizzle(c.env.DB, { schema });
  const scope     = c.req.query('scope') as 'global' | 'company' | undefined;
  const companyId = c.req.query('company_id');

  const result = await listWithMonitors(db, undefined, scope, companyId);
  return c.json(result);
});

// ── POST /v1/admin/policies ────────────────────────────────────────────────────
// Accepts optional clone_from: string to copy an existing policy + its monitors.
policies.post('/', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))
    return c.json({ error: 'unauthorized' }, 401);

  const db  = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    name?:        string;
    description?: string | null;
    scope?:       'global' | 'company';
    company_id?:  string | null;
    target_os?:   string[];
    target_class?: string[];
    clone_from?:  string; // existing policy id to copy from
  }>();

  let name        = body.name ?? '';
  let description = body.description ?? null;
  let scope       = body.scope ?? 'global';
  let companyId   = body.company_id ?? null;
  let targetOs    = body.target_os    ? JSON.stringify(body.target_os)    : '["windows","linux","macos"]';
  let targetClass = body.target_class ? JSON.stringify(body.target_class) : '["server","workstation","laptop"]';

  // If cloning, inherit fields from source unless overridden
  let sourceMonitors: (typeof schema.policyMonitors.$inferSelect)[] = [];
  if (body.clone_from) {
    const source = await db.select().from(schema.policies)
      .where(eq(schema.policies.id, body.clone_from)).get();
    if (!source) return c.json({ error: 'clone_from policy not found' }, 404);

    if (!body.name)        name        = source.name;
    if (!body.description) description = source.description;
    if (!body.target_os)    targetOs    = source.targetOs;
    if (!body.target_class) targetClass = source.targetClass;

    sourceMonitors = await db.select().from(schema.policyMonitors)
      .where(eq(schema.policyMonitors.policyId, source.id));
  }

  if (!name) return c.json({ error: 'name is required' }, 400);
  if (scope === 'company' && !companyId) return c.json({ error: 'company_id required for company scope' }, 400);

  const id = crypto.randomUUID();
  await db.insert(schema.policies).values({
    id, name, description, scope,
    companyId,
    enabled: true,
    targetOs, targetClass,
    createdAt: now, updatedAt: now,
  });

  // Copy monitors when cloning
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

  const result = await listWithMonitors(drizzle(c.env.DB, { schema }), undefined,
    scope === 'global' ? 'global' : undefined,
    companyId ?? undefined,
  );
  const created = result.find(p => p.id === id);
  return c.json(created ?? { id }, 201);
});

// ── PATCH /v1/admin/policies/:id ──────────────────────────────────────────────
policies.patch('/:id', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))
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

  return c.json({ ok: true });
});

// ── DELETE /v1/admin/policies/:id ─────────────────────────────────────────────
policies.delete('/:id', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))
    return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.policies).where(eq(schema.policies.id, c.req.param('id')));
  return c.json({ ok: true });
});

// ── GET /v1/admin/policies/:id/monitors ───────────────────────────────────────
policies.get('/:id/monitors', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))
    return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const monitors = await db.select().from(schema.policyMonitors)
    .where(eq(schema.policyMonitors.policyId, c.req.param('id')));
  return c.json(monitors);
});

// ── POST /v1/admin/policies/:id/monitors ──────────────────────────────────────
policies.post('/:id/monitors', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))
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
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))
    return c.json({ error: 'unauthorized' }, 401);

  const db  = drizzle(c.env.DB, { schema });
  const mid = c.req.param('mid');

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

  return c.json({ ok: true });
});

// ── DELETE /v1/admin/policies/:id/monitors/:mid ───────────────────────────────
policies.delete('/:id/monitors/:mid', async (c) => {
  if (!requireAdmin(c.req.header('Authorization'), c.env.ADMIN_SECRET))
    return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.policyMonitors)
    .where(eq(schema.policyMonitors.id, c.req.param('mid')));
  return c.json({ ok: true });
});

export default policies;
