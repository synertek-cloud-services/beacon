import { Hono } from 'hono';
import type { Bindings } from '../../index';
import { requireUser, type Role } from '../../lib/auth';

const adminJobs = new Hono<{ Bindings: Bindings }>();

function auth(c: any, minRole: Role = 'readonly') {
  return requireUser(c.req.header('Authorization'), c.env, minRole);
}
function uid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// ── Types ──────────────────────────────────────────────────────

type ComponentRef =
  | { type: 'library'; component_id: string; order: number; variable_values?: Record<string, string> }
  | { type: 'inline'; shell: string; script: string; timeout_seconds?: number; order: number };

type ResolvedPayload = { shell: string; script: string; timeout_seconds: number; variables: Record<string, string> };

// ── Helper: resolve payload for a component ref ────────────────
// Library refs also resolve the component's input variables — supplied value,
// else the variable's default, else (if required) a named error surfaced as a 400.

async function resolvePayload(
  db: D1Database,
  ref: ComponentRef,
): Promise<ResolvedPayload | { error: string } | null> {
  if (ref.type === 'inline') {
    return { shell: ref.shell, script: ref.script, timeout_seconds: ref.timeout_seconds ?? 300, variables: {} };
  }
  // library
  const comp = await db.prepare(
    `SELECT shell, script, timeout_seconds FROM components WHERE id = ?`
  ).bind(ref.component_id).first<{ shell: string; script: string; timeout_seconds: number }>();
  if (!comp) return null;

  const vars = await db.prepare(
    `SELECT name, default_value, required FROM component_variables WHERE component_id = ?`
  ).bind(ref.component_id).all<{ name: string; default_value: string | null; required: number }>();

  const variables: Record<string, string> = {};
  for (const v of vars.results) {
    const supplied = ref.variable_values?.[v.name];
    if (supplied !== undefined) { variables[v.name] = supplied; continue; }
    if (v.default_value !== null) { variables[v.name] = v.default_value; continue; }
    if (v.required) return { error: `missing required variable "${v.name}" for component ${ref.component_id}` };
  }

  return { shell: comp.shell, script: comp.script, timeout_seconds: comp.timeout_seconds, variables };
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

// ── Helper: insert commands for an already-resolved device/component set ──

async function insertJobCommands(
  db: D1Database,
  jobId: string,
  devices: Array<{ id: string; tenant_id: string; os_type: string | null }>,
  resolved: { ref: ComponentRef; payload: ResolvedPayload }[],
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const inserts: Promise<any>[] = [];

  for (const device of devices) {
    for (const { ref, payload } of resolved) {
      const shell  = resolveShell(payload.shell, device.os_type);
      const cmdId  = uid();
      const scriptPayload = JSON.stringify({
        shell,
        script: payload.script,
        timeout_seconds: payload.timeout_seconds,
        variables: payload.variables,
      });
      const compId  = ref.type === 'library' ? ref.component_id : null;
      const compOrd = ref.order;

      inserts.push(
        db.prepare(`
          INSERT INTO commands (id, device_id, tenant_id, type, payload, status, created_at, job_id, component_id, component_order)
          VALUES (?, ?, ?, 'run_script', ?, 'queued', ?, ?, ?, ?)
        `).bind(cmdId, device.id, device.tenant_id, scriptPayload, now, jobId, compId, compOrd).run()
      );
    }
  }

  await Promise.all(inserts);
}

// ── Scheduled job dispatch (called from the cron every 2 min) ─────────────
// Target devices are resolved now, not at job-creation time — matches
// Datto's own documented semantics ("devices targeted by a Job are
// calculated just before it is scheduled to run"), since the matching
// device set can legitimately change between creation and a future
// scheduled_at. A job with zero matching devices right now is left
// 'active' and retried on the next cron tick until it either resolves
// devices or expires (see cancelExpiredScheduledJobs below).

export async function dispatchDueScheduledJobs(db: D1Database, now: number): Promise<void> {
  const due = await db.prepare(`
    SELECT j.* FROM jobs j
    WHERE j.type = 'scheduled' AND j.status = 'active'
      AND j.scheduled_at IS NOT NULL AND j.scheduled_at <= ?
      AND (j.expires_at IS NULL OR j.expires_at > ?)
      AND NOT EXISTS (SELECT 1 FROM commands WHERE job_id = j.id)
  `).bind(now, now).all<any>();

  for (const job of due.results) {
    const components: ComponentRef[] = JSON.parse(job.component_ids);
    const targetIds:  string[]       = JSON.parse(job.target_ids);

    const devices = await resolveDevices(db, job.target_type, targetIds);
    if (devices.length === 0) continue;

    const resolutions = await Promise.all(
      components.map(async (ref: ComponentRef) => ({ ref, payload: await resolvePayload(db, ref) }))
    );
    const resolved = resolutions.filter(
      (r): r is { ref: ComponentRef; payload: ResolvedPayload } => r.payload !== null && !('error' in r.payload)
    );
    // A referenced component may have been deleted/edited since creation.
    // Skip this tick rather than partially dispatch; it'll retry until expiry.
    if (resolved.length === 0) continue;

    await insertJobCommands(db, job.id, devices, resolved);
  }
}

// Cancel any queued commands for expired active jobs, then mark those jobs cancelled.
// Handles two cases: scheduled jobs that never dispatched (zero commands), and any
// job (quick or scheduled) whose queued commands were never picked up before expires_at.
export async function cancelExpiredScheduledJobs(db: D1Database, now: number): Promise<void> {
  // First: expire all queued commands belonging to expired active jobs
  await db.prepare(`
    UPDATE commands SET status = 'expired'
    WHERE status = 'queued'
      AND job_id IN (
        SELECT id FROM jobs WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
      )
  `).bind(now).run();

  // Then: cancel any active job past its expiry that has no pending commands left
  await db.prepare(`
    UPDATE jobs SET status = 'cancelled'
    WHERE status = 'active'
      AND expires_at IS NOT NULL AND expires_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM commands WHERE job_id = jobs.id AND status IN ('queued', 'sent')
      )
  `).bind(now).run();
}

// ── Helper: map job row ───────────────────────────────────────

function mapJob(r: any, stats?: { device_count: number; queued: number; sent: number; completed: number; failed: number; expired: number }) {
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
    expiresAt:     r.expires_at,
    createdAt:     r.created_at,
    createdBy:     r.created_by,
    deviceCount:   stats?.device_count ?? 0,
    deviceStats: {
      queued:    stats?.queued    ?? 0,
      sent:      stats?.sent      ?? 0,
      completed: stats?.completed ?? 0,
      failed:    stats?.failed    ?? 0,
      expired:   stats?.expired   ?? 0,
    },
  };
}

// ── GET / — list jobs with aggregate device stats ─────────────

adminJobs.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

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
      SUM(CASE WHEN c.status = 'failed'    THEN 1 ELSE 0 END)            AS failed,
      SUM(CASE WHEN c.status = 'expired'   THEN 1 ELSE 0 END)            AS expired
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
    expired:      r.expired      ?? 0,
  })));
});

// ── GET /:id — job detail with per-device command breakdown ───

adminJobs.get('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');

  const job = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first<any>();
  if (!job) return c.json({ error: 'not found' }, 404);

  const cmds = await c.env.DB.prepare(`
    SELECT
      c.id, c.device_id, c.component_id, c.component_order,
      c.status, c.result, c.warning, c.created_at, c.completed_at,
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
      warning:        row.warning === 1,
      createdAt:      row.created_at,
      completedAt:    row.completed_at,
    });
  }

  const stats = { device_count: deviceMap.size, queued: 0, sent: 0, completed: 0, failed: 0, expired: 0 };
  for (const dev of deviceMap.values()) {
    for (const cmd of dev.commands) {
      if (cmd.status in stats) stats[cmd.status as keyof typeof stats] = (stats[cmd.status as keyof typeof stats] as number) + 1;
    }
  }

  return c.json({
    ...mapJob(job, stats),
    devices: [...deviceMap.values()],
  });
});

// ── POST / — create job + dispatch commands ───────────────────

adminJobs.post('/', async (c) => {
  const user = await auth(c, 'technician');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{
    name: string;
    description?: string;
    type?: 'quick' | 'scheduled';
    components: ComponentRef[];
    target_type?: string;
    target_ids?: string[];
    scheduled_at?: number;
    expires_at?: number;
    run_as_system?: boolean;
  }>();

  if (!body.name?.trim())                     return c.json({ error: 'name required' }, 400);
  if (!body.components || body.components.length === 0) return c.json({ error: 'components required' }, 400);

  const jobType   = body.type ?? 'quick';
  const targetType = body.target_type ?? 'devices';
  const targetIds  = body.target_ids  ?? [];

  // Quick jobs resolve + validate their target devices now, since they
  // dispatch immediately. Scheduled jobs resolve devices later, just
  // before dispatch (see dispatchDueScheduledJobs) — the device set can
  // legitimately change between now and a future scheduled_at.
  let devices: Array<{ id: string; tenant_id: string; os_type: string | null }> = [];
  if (jobType === 'quick') {
    devices = await resolveDevices(c.env.DB, targetType, targetIds);
    if (devices.length === 0 && targetType === 'devices') {
      return c.json({ error: 'no approved devices found for the given IDs' }, 400);
    }
  }

  // Resolve all component payloads up front (validate they exist + required variables are satisfied)
  const resolutions = await Promise.all(
    body.components.map(async (ref) => ({ ref, payload: await resolvePayload(c.env.DB, ref) }))
  );

  for (const { ref, payload } of resolutions) {
    if (payload === null) {
      return c.json({ error: `component not found: ${'component_id' in ref ? ref.component_id : 'inline'}` }, 404);
    }
    if ('error' in payload) {
      return c.json({ error: payload.error }, 400);
    }
  }
  const resolved = resolutions as { ref: ComponentRef; payload: ResolvedPayload }[];

  const now   = Math.floor(Date.now() / 1000);
  const jobId = uid();

  // Create the job record
  const createdBy = user.source === 'break-glass' ? 'Admin' : (user.displayName ?? user.email);
  await c.env.DB.prepare(`
    INSERT INTO jobs (id, name, description, type, status, component_ids, target_type, target_ids, scheduled_at, expires_at, run_as_system, created_at, created_by)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    jobId,
    body.name.trim(),
    body.description ?? null,
    jobType,
    JSON.stringify(body.components),
    targetType,
    JSON.stringify(targetIds),
    body.scheduled_at ?? null,
    body.expires_at ?? null,
    body.run_as_system ?? true,
    now,
    createdBy,
  ).run();

  // Dispatch commands immediately for quick jobs; scheduled jobs wait for
  // the cron (dispatchDueScheduledJobs) to resolve devices and dispatch
  // once scheduled_at arrives.
  if (jobType === 'quick') {
    await insertJobCommands(c.env.DB, jobId, devices, resolved);
  }

  const job = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(jobId).first<any>();
  return c.json(mapJob(job!, { device_count: devices.length, queued: devices.length * body.components.length, sent: 0, completed: 0, failed: 0 }), 201);
});

// ── DELETE /:id — retire job (cancel, keep history) ───────────

adminJobs.delete('/:id', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const id  = c.req.param('id');
  const job = await c.env.DB.prepare(`SELECT id FROM jobs WHERE id = ?`).bind(id).first<any>();
  if (!job) return c.json({ error: 'not found' }, 404);

  await c.env.DB.prepare(
    `UPDATE commands SET status = 'failed' WHERE job_id = ? AND status = 'queued'`
  ).bind(id).run();
  await c.env.DB.prepare(`UPDATE jobs SET status = 'cancelled' WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// ── DELETE /:id/purge — hard delete job + commands ─────────────

adminJobs.delete('/:id/purge', async (c) => {
  if (!(await auth(c, 'admin'))) return c.json({ error: 'unauthorized' }, 401);
  const id  = c.req.param('id');
  const job = await c.env.DB.prepare(`SELECT id FROM jobs WHERE id = ?`).bind(id).first<any>();
  if (!job) return c.json({ error: 'not found' }, 404);

  await c.env.DB.prepare(`DELETE FROM commands WHERE job_id = ?`).bind(id).run();
  await c.env.DB.prepare(`DELETE FROM jobs WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

export default adminJobs;
