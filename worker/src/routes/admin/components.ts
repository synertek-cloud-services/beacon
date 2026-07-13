import { Hono } from 'hono';
import type { Bindings } from '../../index';
import { requireUser, type Role } from '../../lib/auth';

const adminComponents = new Hono<{ Bindings: Bindings }>();

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
    shell:          r.shell,
    script:         r.script,
    timeoutSeconds: r.timeout_seconds,
    createdAt:      r.created_at,
    updatedAt:      r.updated_at,
  };
}

// GET / — list all components, alphabetical
adminComponents.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const result = await c.env.DB.prepare(
    `SELECT * FROM components ORDER BY name ASC`
  ).all<any>();
  return c.json(result.results.map(mapRow));
});

// GET /:id — single component
adminComponents.get('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const row = await c.env.DB.prepare(
    `SELECT * FROM components WHERE id = ?`
  ).bind(c.req.param('id')).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(mapRow(row));
});

// POST / — create component
adminComponents.post('/', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{
    name: string;
    description?: string | null;
    category?: string | null;
    type?: 'script' | 'application';
    shell?: string;
    script: string;
    timeout_seconds?: number;
  }>();

  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  if (!body.script?.trim()) return c.json({ error: 'script required' }, 400);

  const id  = uid();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(`
    INSERT INTO components (id, name, description, category, type, shell, script, timeout_seconds, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.name.trim(),
    body.description ?? null,
    body.category ?? null,
    body.type ?? 'script',
    body.shell ?? 'auto',
    body.script,
    body.timeout_seconds ?? 300,
    now, now,
  ).run();

  const row = await c.env.DB.prepare(`SELECT * FROM components WHERE id = ?`).bind(id).first<any>();
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
    shell: string;
    script: string;
    timeout_seconds: number;
  }>>();

  const row = await c.env.DB.prepare(`SELECT id FROM components WHERE id = ?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);

  const sets: string[] = ['updated_at = ?'];
  const vals: any[] = [Math.floor(Date.now() / 1000)];

  if (body.name        !== undefined) { sets.push('name = ?');            vals.push(body.name); }
  if (body.description !== undefined) { sets.push('description = ?');     vals.push(body.description); }
  if (body.category    !== undefined) { sets.push('category = ?');        vals.push(body.category); }
  if (body.type        !== undefined) { sets.push('type = ?');            vals.push(body.type); }
  if (body.shell       !== undefined) { sets.push('shell = ?');           vals.push(body.shell); }
  if (body.script      !== undefined) { sets.push('script = ?');          vals.push(body.script); }
  if (body.timeout_seconds !== undefined) { sets.push('timeout_seconds = ?'); vals.push(body.timeout_seconds); }

  vals.push(id);
  await c.env.DB.prepare(`UPDATE components SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

// DELETE /:id — delete component
adminComponents.delete('/:id', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const id  = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT id FROM components WHERE id = ?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare(`DELETE FROM components WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

export default adminComponents;
