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
    companyId:      r.company_id,
    // Only present when the query joined tenants (see companyJoinSelect) — undefined otherwise
    companyName:    r.company_name ?? null,
    shell:          r.shell,
    script:         r.script,
    timeoutSeconds: r.timeout_seconds,
    postConditions: JSON.parse(r.post_conditions || '[]') as PostCondition[],
    createdAt:      r.created_at,
    updatedAt:      r.updated_at,
  };
}

// Shared SELECT fragment for routes that display components (embeds the
// scoped company's name so the dashboard doesn't need a second round-trip)
const componentSelectWithCompany = `SELECT c.*, t.name AS company_name FROM components c LEFT JOIN tenants t ON t.id = c.company_id`;

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

// Fetch components + their variables in two queries, merge in TS (mirrors
// policies.ts's listWithMonitors pattern) — avoids N+1 lookups from the dashboard.
async function embedVariables(db: D1Database, rows: any[]) {
  if (!rows.length) return rows.map(r => ({ ...mapRow(r), variables: [] as ReturnType<typeof mapVariable>[] }));
  const ids = rows.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const vars = await db.prepare(
    `SELECT * FROM component_variables WHERE component_id IN (${placeholders}) ORDER BY sort_order ASC`
  ).bind(...ids).all<any>();
  const byComponent = new Map<string, ReturnType<typeof mapVariable>[]>();
  for (const v of vars.results) {
    const mapped = mapVariable(v);
    if (!byComponent.has(mapped.componentId)) byComponent.set(mapped.componentId, []);
    byComponent.get(mapped.componentId)!.push(mapped);
  }
  return rows.map(r => ({ ...mapRow(r), variables: byComponent.get(r.id) ?? [] }));
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
    `${componentSelectWithCompany} WHERE c.origin = 'store' ORDER BY c.name ASC`
  ).all<any>();
  return c.json(await embedVariables(c.env.DB, result.results));
});

// GET /?company_id=<id> — list components. With no company_id, returns
// everything (used by the library list page). With company_id, returns only
// what's usable against that company: global components + that company's
// own scoped ones — used by job-creation flows targeting a single company.
adminComponents.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const companyId = c.req.query('company_id');

  const result = companyId
    ? await c.env.DB.prepare(
        `${componentSelectWithCompany} WHERE c.scope = 'global' OR c.company_id = ? ORDER BY c.name ASC`
      ).bind(companyId).all<any>()
    : await c.env.DB.prepare(`${componentSelectWithCompany} ORDER BY c.name ASC`).all<any>();

  return c.json(await embedVariables(c.env.DB, result.results));
});

// GET /:id — single component
adminComponents.get('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const row = await c.env.DB.prepare(
    `${componentSelectWithCompany} WHERE c.id = ?`
  ).bind(c.req.param('id')).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const [withVars] = await embedVariables(c.env.DB, [row]);
  return c.json(withVars);
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
    company_id?: string | null;
    shell?: string;
    script: string;
    timeout_seconds?: number;
    post_conditions?: PostCondition[];
  }>();

  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  if (!body.script?.trim()) return c.json({ error: 'script required' }, 400);
  const scope = body.scope ?? 'global';
  if (scope === 'company' && !body.company_id) return c.json({ error: 'company_id required for company scope' }, 400);

  const id  = uid();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(`
    INSERT INTO components (id, name, description, category, type, origin, scope, company_id, shell, script, timeout_seconds, post_conditions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.name.trim(),
    body.description ?? null,
    body.category ?? null,
    body.type ?? 'script',
    scope,
    scope === 'company' ? body.company_id : null,
    body.shell ?? 'auto',
    body.script,
    body.timeout_seconds ?? 300,
    JSON.stringify(body.post_conditions ?? []),
    now, now,
  ).run();

  const row = await c.env.DB.prepare(`${componentSelectWithCompany} WHERE c.id = ?`).bind(id).first<any>();
  return c.json(mapRow(row!), 201);
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
    company_id: string | null;
    shell: string;
    script: string;
    timeout_seconds: number;
    post_conditions: PostCondition[];
  }>>();

  const row = await c.env.DB.prepare(`SELECT id, origin, scope, company_id FROM components WHERE id = ?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.origin === 'store') return c.json({ error: 'store components are read-only — clone to your library to edit' }, 403);

  const effectiveScope = body.scope ?? row.scope;
  const effectiveCompanyId = body.company_id !== undefined ? body.company_id : row.company_id;
  if (effectiveScope === 'company' && !effectiveCompanyId) return c.json({ error: 'company_id required for company scope' }, 400);

  const sets: string[] = ['updated_at = ?'];
  const vals: any[] = [Math.floor(Date.now() / 1000)];

  if (body.name        !== undefined) { sets.push('name = ?');            vals.push(body.name); }
  if (body.description !== undefined) { sets.push('description = ?');     vals.push(body.description); }
  if (body.category    !== undefined) { sets.push('category = ?');        vals.push(body.category); }
  if (body.type        !== undefined) { sets.push('type = ?');            vals.push(body.type); }
  if (body.scope       !== undefined) { sets.push('scope = ?');           vals.push(body.scope); }
  if (body.company_id  !== undefined) { sets.push('company_id = ?');      vals.push(effectiveScope === 'company' ? body.company_id : null); }
  else if (body.scope === 'global')   { sets.push('company_id = ?');      vals.push(null); }
  if (body.shell       !== undefined) { sets.push('shell = ?');           vals.push(body.shell); }
  if (body.script      !== undefined) { sets.push('script = ?');          vals.push(body.script); }
  if (body.timeout_seconds !== undefined) { sets.push('timeout_seconds = ?'); vals.push(body.timeout_seconds); }
  if (body.post_conditions !== undefined) { sets.push('post_conditions = ?'); vals.push(JSON.stringify(body.post_conditions)); }

  vals.push(id);
  await c.env.DB.prepare(`UPDATE components SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
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
    INSERT INTO components (id, name, description, category, type, origin, scope, company_id, shell, script, timeout_seconds, post_conditions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newId, name, source.description, source.category, source.type,
    source.scope, source.company_id,
    source.shell, source.script, source.timeout_seconds, source.post_conditions,
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

  const row = await c.env.DB.prepare(`${componentSelectWithCompany} WHERE c.id = ?`).bind(newId).first<any>();
  const [withVars] = await embedVariables(c.env.DB, [row]);
  return c.json(withVars, 201);
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
