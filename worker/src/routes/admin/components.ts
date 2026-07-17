import { Hono } from 'hono';
import type { Bindings } from '../../index';
import { requireUser, type Role } from '../../lib/auth';
import type { PostCondition } from '../../lib/postConditions';

const adminComponents = new Hono<{ Bindings: Bindings }>();

type VariableType = 'string' | 'selection' | 'boolean' | 'date';
const VALID_VARIABLE_TYPES: VariableType[] = ['string', 'selection', 'boolean', 'date'];
const VARIABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function auth(c: any, minRole: Role = 'readonly') {
  return requireUser(c.req.header('Authorization'), c.env, minRole);
}

function uid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function mapRow(r: any) {
  return {
    id:             r.id,
    name:           r.name,
    description:    r.description,
    category:       r.category,
    type:           r.type,
    origin:         r.origin,
    scope:          r.scope,
    shell:          r.shell,
    script:         r.script,
    timeoutSeconds: r.timeout_seconds,
    postConditions: JSON.parse(r.post_conditions || '[]') as PostCondition[],
    targetOs:       r.target_os ?? null,
    createdAt:      r.created_at,
    updatedAt:      r.updated_at,
  };
}

function mapSite(r: any) {
  return { tenantId: r.tenant_id, name: r.name };
}

function mapVariable(r: any) {
  return {
    id:            r.id,
    componentId:   r.component_id,
    name:          r.name,
    label:         r.label,
    type:          r.type,
    options:       r.options ? JSON.parse(r.options) : null,
    defaultValue:  r.default_value,
    description:   r.description,
    required:      Boolean(r.required),
    sortOrder:     r.sort_order,
    createdAt:     r.created_at,
  };
}

// Fetch components + their variables + their sites in three queries, merge in
// TS (mirrors policies.ts's listWithMonitors pattern) — avoids N+1 lookups
// from the dashboard.
async function embedRelations(db: D1Database, rows: any[]) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');

  const vars = await db.prepare(
    `SELECT * FROM component_variables WHERE component_id IN (${placeholders}) ORDER BY sort_order ASC`
  ).bind(...ids).all<any>();
  const varsByComponent = new Map<string, ReturnType<typeof mapVariable>[]>();
  for (const v of vars.results) {
    const mapped = mapVariable(v);
    if (!varsByComponent.has(mapped.componentId)) varsByComponent.set(mapped.componentId, []);
    varsByComponent.get(mapped.componentId)!.push(mapped);
  }

  const sites = await db.prepare(
    `SELECT cs.component_id, cs.tenant_id, t.name FROM component_sites cs
     JOIN tenants t ON t.id = cs.tenant_id
     WHERE cs.component_id IN (${placeholders}) ORDER BY t.name ASC`
  ).bind(...ids).all<any>();
  const sitesByComponent = new Map<string, ReturnType<typeof mapSite>[]>();
  for (const s of sites.results) {
    if (!sitesByComponent.has(s.component_id)) sitesByComponent.set(s.component_id, []);
    sitesByComponent.get(s.component_id)!.push(mapSite(s));
  }

  return rows.map(r => ({
    ...mapRow(r),
    variables: varsByComponent.get(r.id) ?? [],
    sites: sitesByComponent.get(r.id) ?? [],
  }));
}

function validateVariableBody(body: any): string | null {
  if (!body.name?.trim()) return 'variable name is required';
  if (!VARIABLE_NAME_RE.test(body.name)) return 'variable name must be a valid identifier (letters, numbers, underscore, not starting with a number)';
  if (!body.label?.trim()) return 'variable label is required';
  if (body.type !== undefined && !VALID_VARIABLE_TYPES.includes(body.type)) return 'invalid variable type';
  const type: VariableType = body.type ?? 'string';
  if (type === 'selection') {
    if (!Array.isArray(body.options) || body.options.length === 0) return 'selection variables require a non-empty options list';
    for (const opt of body.options) {
      if (typeof opt?.label !== 'string' || typeof opt?.value !== 'string') return 'each selection option needs a label and value';
    }
  }
  return null;
}

// ── GET /store — read-only, must be registered before GET /:id ──────────────
adminComponents.get('/store', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const result = await c.env.DB.prepare(
    `SELECT * FROM components WHERE origin = 'store' ORDER BY name ASC`
  ).all<any>();
  return c.json(await embedRelations(c.env.DB, result.results));
});

// GET /?company_id=<id> — list components. With no company_id, returns
// everything (used by the library list page). With company_id, returns only
// what's usable against that company: global components + components whose
// Sites list includes that company — used by job-creation flows targeting a
// single company.
adminComponents.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const companyId = c.req.query('company_id');

  const result = companyId
    ? await c.env.DB.prepare(
        `SELECT * FROM components WHERE scope = 'global' OR id IN (SELECT component_id FROM component_sites WHERE tenant_id = ?) ORDER BY name ASC`
      ).bind(companyId).all<any>()
    : await c.env.DB.prepare(`SELECT * FROM components ORDER BY name ASC`).all<any>();

  return c.json(await embedRelations(c.env.DB, result.results));
});

// GET /:id — single component
adminComponents.get('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const row = await c.env.DB.prepare(
    `SELECT * FROM components WHERE id = ?`
  ).bind(c.req.param('id')).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const [withRelations] = await embedRelations(c.env.DB, [row]);
  return c.json(withRelations);
});

// POST / — create component (always origin='custom' — store rows only come
// from the seed migration or /:id/clone)
adminComponents.post('/', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{
    name: string;
    description?: string | null;
    category?: string | null;
    type?: 'script' | 'application';
    scope?: 'global' | 'company';
    shell?: string;
    script: string;
    timeout_seconds?: number;
    post_conditions?: PostCondition[];
    target_os?: string | null;
  }>();

  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  if (!body.script?.trim()) return c.json({ error: 'script required' }, 400);
  const scope = body.scope ?? 'global';

  const id  = uid();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(`
    INSERT INTO components (id, name, description, category, type, origin, scope, shell, script, timeout_seconds, post_conditions, target_os, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.name.trim(),
    body.description ?? null,
    body.category ?? null,
    body.type ?? 'script',
    scope,
    body.shell ?? 'auto',
    body.script,
    body.timeout_seconds ?? 300,
    JSON.stringify(body.post_conditions ?? []),
    body.target_os ?? null,
    now, now,
  ).run();

  // Sites are added afterward via POST /:id/sites (mirrors how variables are
  // batched onto a brand-new component) — a fresh component always starts
  // with an empty Sites list even when scope is 'company'.
  const row = await c.env.DB.prepare(`SELECT * FROM components WHERE id = ?`).bind(id).first<any>();
  const [withRelations] = await embedRelations(c.env.DB, [row]);
  return c.json(withRelations, 201);
});

// PATCH /:id — update component
adminComponents.patch('/:id', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const id   = c.req.param('id');
  const body = await c.req.json<Partial<{
    name: string;
    description: string | null;
    category: string | null;
    type: 'script' | 'application';
    scope: 'global' | 'company';
    shell: string;
    script: string;
    timeout_seconds: number;
    post_conditions: PostCondition[];
    target_os: string | null;
  }>>();

  const row = await c.env.DB.prepare(`SELECT id, origin FROM components WHERE id = ?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.origin === 'store') return c.json({ error: 'store components are read-only — clone to your library to edit' }, 403);

  const sets: string[] = ['updated_at = ?'];
  const vals: any[] = [Math.floor(Date.now() / 1000)];

  if (body.name        !== undefined) { sets.push('name = ?');            vals.push(body.name); }
  if (body.description !== undefined) { sets.push('description = ?');     vals.push(body.description); }
  if (body.category    !== undefined) { sets.push('category = ?');        vals.push(body.category); }
  if (body.type        !== undefined) { sets.push('type = ?');            vals.push(body.type); }
  if (body.scope       !== undefined) { sets.push('scope = ?');           vals.push(body.scope); }
  if (body.shell       !== undefined) { sets.push('shell = ?');           vals.push(body.shell); }
  if (body.script      !== undefined) { sets.push('script = ?');          vals.push(body.script); }
  if (body.timeout_seconds !== undefined) { sets.push('timeout_seconds = ?'); vals.push(body.timeout_seconds); }
  if (body.post_conditions !== undefined) { sets.push('post_conditions = ?'); vals.push(JSON.stringify(body.post_conditions)); }
  if (body.target_os       !== undefined) { sets.push('target_os = ?');       vals.push(body.target_os); }

  vals.push(id);
  await c.env.DB.prepare(`UPDATE components SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();

  // Switching back to global drops any Sites membership — a "Remove all"
  // equivalent, so re-enabling company scope later starts from a clean list
  // rather than silently resurrecting stale sites.
  if (body.scope === 'global') {
    await c.env.DB.prepare(`DELETE FROM component_sites WHERE component_id = ?`).bind(id).run();
  }

  return c.json({ ok: true });
});

// DELETE /:id — delete component
adminComponents.delete('/:id', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const id  = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT id, origin FROM components WHERE id = ?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.origin === 'store') return c.json({ error: 'store components are read-only — clone to your library to edit' }, 403);
  await c.env.DB.prepare(`DELETE FROM components WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// ── POST /:id/clone — copy a component (any origin) into a fresh 'custom' one ──
adminComponents.post('/:id/clone', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const sourceId = c.req.param('id');
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });

  const source = await c.env.DB.prepare(`SELECT * FROM components WHERE id = ?`).bind(sourceId).first<any>();
  if (!source) return c.json({ error: 'not found' }, 404);

  const newId = uid();
  const now   = Math.floor(Date.now() / 1000);
  const name  = body.name?.trim() || `${source.name} (Copy)`;

  await c.env.DB.prepare(`
    INSERT INTO components (id, name, description, category, type, origin, scope, shell, script, timeout_seconds, post_conditions, target_os, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newId, name, source.description, source.category, source.type,
    source.scope,
    source.shell, source.script, source.timeout_seconds, source.post_conditions, source.target_os ?? null,
    now, now,
  ).run();

  const sourceVars = await c.env.DB.prepare(
    `SELECT * FROM component_variables WHERE component_id = ? ORDER BY sort_order ASC`
  ).bind(sourceId).all<any>();

  for (const v of sourceVars.results) {
    await c.env.DB.prepare(`
      INSERT INTO component_variables (id, component_id, name, label, type, options, default_value, description, required, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(uid(), newId, v.name, v.label, v.type, v.options, v.default_value, v.description, v.required, v.sort_order, now).run();
  }

  const sourceSites = await c.env.DB.prepare(
    `SELECT tenant_id FROM component_sites WHERE component_id = ?`
  ).bind(sourceId).all<any>();

  for (const s of sourceSites.results) {
    await c.env.DB.prepare(`
      INSERT INTO component_sites (id, component_id, tenant_id, created_at) VALUES (?, ?, ?, ?)
    `).bind(uid(), newId, s.tenant_id, now).run();
  }

  const row = await c.env.DB.prepare(`SELECT * FROM components WHERE id = ?`).bind(newId).first<any>();
  const [withRelations] = await embedRelations(c.env.DB, [row]);
  return c.json(withRelations, 201);
});

// ── Sites (nested, independent lifecycle — a component can be added to
// several sites one at a time via an "Add Site" flyout, mirroring Datto) ────

adminComponents.get('/:id/sites', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const result = await c.env.DB.prepare(
    `SELECT cs.tenant_id, t.name FROM component_sites cs
     JOIN tenants t ON t.id = cs.tenant_id
     WHERE cs.component_id = ? ORDER BY t.name ASC`
  ).bind(c.req.param('id')).all<any>();
  return c.json(result.results.map(mapSite));
});

adminComponents.post('/:id/sites', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const componentId = c.req.param('id');

  const component = await c.env.DB.prepare(`SELECT origin FROM components WHERE id = ?`).bind(componentId).first<any>();
  if (!component) return c.json({ error: 'component not found' }, 404);
  if (component.origin === 'store') return c.json({ error: 'store components are read-only — clone to your library to edit' }, 403);

  const body = await c.req.json<{ tenant_id: string }>();
  if (!body.tenant_id) return c.json({ error: 'tenant_id required' }, 400);

  const tenant = await c.env.DB.prepare(`SELECT id FROM tenants WHERE id = ?`).bind(body.tenant_id).first<any>();
  if (!tenant) return c.json({ error: 'site not found' }, 404);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO component_sites (id, component_id, tenant_id, created_at) VALUES (?, ?, ?, ?)`
  ).bind(uid(), componentId, body.tenant_id, Math.floor(Date.now() / 1000)).run();

  return c.json({ ok: true }, 201);
});

adminComponents.delete('/:id/sites/:tenantId', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const componentId = c.req.param('id');

  const component = await c.env.DB.prepare(`SELECT origin FROM components WHERE id = ?`).bind(componentId).first<any>();
  if (!component) return c.json({ error: 'component not found' }, 404);
  if (component.origin === 'store') return c.json({ error: 'store components are read-only — clone to your library to edit' }, 403);

  await c.env.DB.prepare(
    `DELETE FROM component_sites WHERE component_id = ? AND tenant_id = ?`
  ).bind(componentId, c.req.param('tenantId')).run();
  return c.json({ ok: true });
});

// ── Variables (nested, independent lifecycle — mirrors policy_monitors) ──────

adminComponents.get('/:id/variables', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const result = await c.env.DB.prepare(
    `SELECT * FROM component_variables WHERE component_id = ? ORDER BY sort_order ASC`
  ).bind(c.req.param('id')).all<any>();
  return c.json(result.results.map(mapVariable));
});

adminComponents.post('/:id/variables', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const componentId = c.req.param('id');

  const component = await c.env.DB.prepare(`SELECT origin FROM components WHERE id = ?`).bind(componentId).first<any>();
  if (!component) return c.json({ error: 'component not found' }, 404);
  if (component.origin === 'store') return c.json({ error: 'store components are read-only — clone to your library to edit' }, 403);

  const body = await c.req.json<{
    name: string;
    label: string;
    type?: VariableType;
    options?: { label: string; value: string }[];
    default_value?: string | null;
    description?: string | null;
    required?: boolean;
    sort_order?: number;
  }>();

  const err = validateVariableBody(body);
  if (err) return c.json({ error: err }, 400);

  const id  = uid();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(`
    INSERT INTO component_variables (id, component_id, name, label, type, options, default_value, description, required, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, componentId, body.name.trim(), body.label.trim(), body.type ?? 'string',
    body.type === 'selection' ? JSON.stringify(body.options) : null,
    body.default_value ?? null, body.description ?? null,
    body.required ?? true, body.sort_order ?? 0, now,
  ).run();

  const row = await c.env.DB.prepare(`SELECT * FROM component_variables WHERE id = ?`).bind(id).first<any>();
  return c.json(mapVariable(row!), 201);
});

adminComponents.patch('/:id/variables/:vid', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const componentId = c.req.param('id');
  const vid = c.req.param('vid');

  const component = await c.env.DB.prepare(`SELECT origin FROM components WHERE id = ?`).bind(componentId).first<any>();
  if (!component) return c.json({ error: 'component not found' }, 404);
  if (component.origin === 'store') return c.json({ error: 'store components are read-only — clone to your library to edit' }, 403);

  const existing = await c.env.DB.prepare(`SELECT * FROM component_variables WHERE id = ? AND component_id = ?`).bind(vid, componentId).first<any>();
  if (!existing) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<Partial<{
    name: string;
    label: string;
    type: VariableType;
    options: { label: string; value: string }[];
    default_value: string | null;
    description: string | null;
    required: boolean;
    sort_order: number;
  }>>();

  const merged = {
    name:  body.name  ?? existing.name,
    label: body.label ?? existing.label,
    type:  body.type  ?? existing.type,
    options: body.options !== undefined ? body.options : (existing.options ? JSON.parse(existing.options) : undefined),
  };
  const err = validateVariableBody(merged);
  if (err) return c.json({ error: err }, 400);

  const sets: string[] = [];
  const vals: any[] = [];
  if (body.name          !== undefined) { sets.push('name = ?');          vals.push(body.name.trim()); }
  if (body.label         !== undefined) { sets.push('label = ?');         vals.push(body.label.trim()); }
  if (body.type          !== undefined) { sets.push('type = ?');          vals.push(body.type); }
  if (body.options       !== undefined) { sets.push('options = ?');       vals.push(JSON.stringify(body.options)); }
  if (body.default_value !== undefined) { sets.push('default_value = ?'); vals.push(body.default_value); }
  if (body.description   !== undefined) { sets.push('description = ?');   vals.push(body.description); }
  if (body.required      !== undefined) { sets.push('required = ?');      vals.push(body.required); }
  if (body.sort_order    !== undefined) { sets.push('sort_order = ?');    vals.push(body.sort_order); }

  if (sets.length) {
    vals.push(vid);
    await c.env.DB.prepare(`UPDATE component_variables SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  }
  return c.json({ ok: true });
});

adminComponents.delete('/:id/variables/:vid', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const componentId = c.req.param('id');
  const vid = c.req.param('vid');

  const component = await c.env.DB.prepare(`SELECT origin FROM components WHERE id = ?`).bind(componentId).first<any>();
  if (!component) return c.json({ error: 'component not found' }, 404);
  if (component.origin === 'store') return c.json({ error: 'store components are read-only — clone to your library to edit' }, 403);

  await c.env.DB.prepare(`DELETE FROM component_variables WHERE id = ? AND component_id = ?`).bind(vid, componentId).run();
  return c.json({ ok: true });
});

export default adminComponents;
