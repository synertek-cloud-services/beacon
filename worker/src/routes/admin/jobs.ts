import { Hono } from 'hono';
import type { Bindings } from '../../index';

const adminJobs = new Hono<{ Bindings: Bindings }>();

function auth(c: any): boolean {
  return c.req.header('Authorization') === `Bearer ${c.env.ADMIN_SECRET}`;
}
function uid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// ── Types ──────────────────────────────────────────────────────

type ComponentRef =
  | { type: 'library'; component_id: string; order: number }
  | { type: 'inline'; shell: string; script: string; timeout_seconds?: number; order: number };

// ── Helper: resolve payload for a component ref ────────────────

async function resolvePayload(
  db: D1Database,
  ref: ComponentRef,
): Promise<{ shell: string; script: string; timeout_seconds: number } | null> {
  if (ref.type === 'inline') {
    return { shell: ref.shell, script: ref.script, timeout_seconds: ref.timeout_seconds ?? 300 };
  }
  // library
  const comp = await db.prepare(
    `SELECT shell, script, timeout_seconds FROM components WHERE id = ?`
  ).bind(ref.component_id).first<{ shell: string; script: string; timeout_seconds: number }>();
  return comp ?? null;
}

// ── Helper: resolve target device rows ────────────────────────

async function resolveDevices(
  db: D1Database,
  targetType: string,
  targetIds: string[],
): Promise<Array<{ id: string; tenant_id: string; os_type: string | null }>> {
  if (targetType === 'devices') {
    if (targetIds.length === 0) return [];
    const placeholders = targetIds.map(() => '?').join(',');
    const result = await db.prepare(
      `SELECT id, tenant_id, os_type FROM devices WHERE id IN (${placeholders}) AND status = 'approved'`
    ).bind(...targetIds).all<{ id: string; tenant_id: string; os_type: string | null }>();
    return result.results;
  }
  if (targetType === 'tenants') {
    if (targetIds.length === 0) return [];
    const placeholders = targetIds.map(() => '?').join(',');
    const result = await db.prepare(
      `SELECT id, tenant_id, os_type FROM devices WHERE tenant_id IN (${placeholders}) AND status = 'approved'`
    ).bind(...targetIds).all<{ id: string; tenant_id: string; os_type: string | null }>();
    return result.results;
  }
  // 'all'
  const result = await db.prepare(
    `SELECT id, tenant_id, os_type FROM devices WHERE status = 'approved'`
  ).all<{ id: string; tenant_id: string; os_type: string | null }>();
  return result.results;
}

// ── Helper: resolve shell for 'auto' ─────────────────────────

function resolveShell(shell: string, osType: string | null): string {
  if (shell !== 'auto') return shell;
  return osType?.toLowerCase() === 'windows' ? 'powershell' : 'bash';
}

// ── Helper: map job row ───────────────────────────────────────

function mapJob(r: any, stats?: { device_count: number; queued: number; sent: number; completed: number; failed: number }) {
  return {
    id:            r.id,
    name:          r.name,
    description:   r.description,
    type:          r.type,
    status:        r.status,
    componentIds:  r.component_ids,
    targetType:    r.target_type,
    targetIds:     r.target_ids,
    runAsSystem:   Boolean(r.run_as_system),
    scheduledAt:   r.scheduled_at,
    createdAt:     r.created_at,
    createdBy:     r.created_by,
    deviceCount:   stats?.device_count ?? 0,
    deviceStats: {
      queued:    stats?.queued    ?? 0,
      sent:      stats?.sent      ?? 0,
      completed: stats?.completed ?? 0,
      failed:    stats?.failed    ?? 0,
    },
  };
}

// ── GET / — list jobs with aggregate device stats ─────────────

adminJobs.get('/', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const typeFilter   = c.req.query('type');
  const statusFilter = c.req.query('status');

  const conditions: string[] = [];
  const bindings:   any[]    = [];

  if (typeFilter)   { conditions.push('j.type = ?');   bindings.push(typeFilter); }
  if (statusFilter) { conditions.push('j.status = ?'); bindings.push(statusFilter); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await c.env.DB.prepare(`
    SELECT
      j.*,
      COUNT(DISTINCT c.device_id)                                         AS device_count,
      SUM(CASE WHEN c.status = 'queued'    THEN 1 ELSE 0 END)            AS queued,
      SUM(CASE WHEN c.status = 'sent'      THEN 1 ELSE 0 END)            AS sent,
      SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END)            AS completed,
      SUM(CASE WHEN c.status = 'failed'    THEN 1 ELSE 0 END)            AS failed
    FROM jobs j
    LEFT JOIN commands c ON c.job_id = j.id
    ${where}
    GROUP BY j.id
    ORDER BY j.created_at DESC
    LIMIT 200
  `).bind(...bindings).all<any>();

  return c.json(result.results.map(r => mapJob(r, {
    device_count: r.device_count ?? 0,
    queued:       r.queued       ?? 0,
    sent:         r.sent         ?? 0,
    completed:    r.completed    ?? 0,
    failed:       r.failed       ?? 0,
  })));
});

// ── GET /:id — job detail with per-device command breakdown ───

adminJobs.get('/:id', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');

  const job = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first<any>();
  if (!job) return c.json({ error: 'not found' }, 404);

  const cmds = await c.env.DB.prepare(`
    SELECT
      c.id, c.device_id, c.component_id, c.component_order,
      c.status, c.result, c.created_at, c.completed_at,
      d.hostname, d.os_type,
      t.name AS tenant_name,
      comp.name AS component_name
    FROM commands c
    JOIN devices d ON d.id = c.device_id
    JOIN tenants t ON t.id = c.tenant_id
    LEFT JOIN components comp ON comp.id = c.component_id
    WHERE c.job_id = ?
    ORDER BY c.device_id, c.component_order ASC
  `).bind(id).all<any>();

  // Group by device
  const deviceMap = new Map<string, {
    deviceId: string; hostname: string | null; osType: string | null; tenantName: string;
    commands: any[];
  }>();

  for (const row of cmds.results) {
    if (!deviceMap.has(row.device_id)) {
      deviceMap.set(row.device_id, {
        deviceId:   row.device_id,
        hostname:   row.hostname,
        osType:     row.os_type,
        tenantName: row.tenant_name,
        commands:   [],
      });
    }
    deviceMap.get(row.device_id)!.commands.push({
      id:             row.id,
      componentId:    row.component_id,
      componentName:  row.component_name,
      componentOrder: row.component_order,
      status:         row.status,
      result:         row.result,
      createdAt:      row.created_at,
      completedAt:    row.completed_at,
    });
  }

  const stats = { device_count: deviceMap.size, queued: 0, sent: 0, completed: 0, failed: 0 };
  for (const dev of deviceMap.values()) {
    for (const cmd of dev.commands) {
      stats[cmd.status as keyof typeof stats] = (stats[cmd.status as keyof typeof stats] as number) + 1;
    }
  }

  return c.json({
    ...mapJob(job, stats),
    devices: [...deviceMap.values()],
  });
});

// ── POST / — create job + dispatch commands ───────────────────

adminJobs.post('/', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{
    name: string;
    description?: string;
    type?: 'quick' | 'scheduled';
    components: ComponentRef[];
    target_type?: string;
    target_ids?: string[];
    scheduled_at?: number;
  }>();

  if (!body.name?.trim())                     return c.json({ error: 'name required' }, 400);
  if (!body.components || body.components.length === 0) return c.json({ error: 'components required' }, 400);

  const jobType   = body.type ?? 'quick';
  const targetType = body.target_type ?? 'devices';
  const targetIds  = body.target_ids  ?? [];

  // Resolve target devices
  const devices = await resolveDevices(c.env.DB, targetType, targetIds);
  if (devices.length === 0 && targetType === 'devices') {
    return c.json({ error: 'no approved devices found for the given IDs' }, 400);
  }

  // Resolve all component payloads up front (validate they exist)
  const resolved = await Promise.all(
    body.components.map(async (ref) => {
      const payload = await resolvePayload(c.env.DB, ref);
      if (!payload) return c.json({ error: `component not found: ${'component_id' in ref ? ref.component_id : 'inline'}` }, 404) as any;
      return { ref, payload };
    })
  );

  const now   = Math.floor(Date.now() / 1000);
  const jobId = uid();

  // Create the job record
  await c.env.DB.prepare(`
    INSERT INTO jobs (id, name, description, type, status, component_ids, target_type, target_ids, scheduled_at, created_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `).bind(
    jobId,
    body.name.trim(),
    body.description ?? null,
    jobType,
    JSON.stringify(body.components),
    targetType,
    JSON.stringify(targetIds),
    body.scheduled_at ?? null,
    now,
  ).run();

  // Dispatch commands immediately for quick jobs
  if (jobType === 'quick') {
    const inserts: Promise<any>[] = [];

    for (const device of devices) {
      for (const { ref, payload } of resolved) {
        const shell  = resolveShell(payload.shell, device.os_type);
        const cmdId  = uid();
        const scriptPayload = JSON.stringify({
          shell,
          script: payload.script,
          timeout_seconds: payload.timeout_seconds,
        });
        const compId  = ref.type === 'library' ? ref.component_id : null;
        const compOrd = ref.order;

        inserts.push(
          c.env.DB.prepare(`
            INSERT INTO commands (id, device_id, tenant_id, type, payload, status, created_at, job_id, component_id, component_order)
            VALUES (?, ?, ?, 'run_script', ?, 'queued', ?, ?, ?, ?)
          `).bind(cmdId, device.id, device.tenant_id, scriptPayload, now, jobId, compId, compOrd).run()
        );
      }
    }

    await Promise.all(inserts);
  }

  const job = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(jobId).first<any>();
  return c.json(mapJob(job!, { device_count: devices.length, queued: devices.length * body.components.length, sent: 0, completed: 0, failed: 0 }), 201);
});

// ── DELETE /:id — cancel job ──────────────────────────────────

adminJobs.delete('/:id', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const id  = c.req.param('id');
  const job = await c.env.DB.prepare(`SELECT id FROM jobs WHERE id = ?`).bind(id).first<any>();
  if (!job) return c.json({ error: 'not found' }, 404);

  // Cancel queued commands that haven't been sent yet
  await c.env.DB.prepare(
    `UPDATE commands SET status = 'failed' WHERE job_id = ? AND status = 'queued'`
  ).bind(id).run();

  await c.env.DB.prepare(`UPDATE jobs SET status = 'cancelled' WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

export default adminJobs;
