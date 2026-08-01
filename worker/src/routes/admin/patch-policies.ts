import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, inArray } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';
import { copyPatchPolicyTargets } from '../../lib/patchPolicies';

const patchPolicies = new Hono<{ Bindings: Bindings }>();

type RecurrenceType = 'one_time' | 'weekly';
type Severity = 'Critical' | 'Important' | 'Moderate' | 'Low';
const VALID_SEVERITIES: Severity[] = ['Critical', 'Important', 'Moderate', 'Low'];

interface RecurrenceBody {
  type: RecurrenceType;
  one_time_start_at?: number;
  one_time_duration_minutes?: number;
  weekly_days?: number[];
  weekly_start_minute?: number;
  weekly_duration_minutes?: number;
}

// Identical to maintenance-policies.ts's validateRecurrence -- duplicated,
// not shared, same per-policy-type mirroring convention.
function validateRecurrence(r: RecurrenceBody): { patch: Record<string, unknown> } | { error: string } {
  if (r.type === 'one_time') {
    if (typeof r.one_time_start_at !== 'number') return { error: 'one_time_start_at is required' };
    if (typeof r.one_time_duration_minutes !== 'number' || r.one_time_duration_minutes <= 0) {
      return { error: 'one_time_duration_minutes must be a positive number' };
    }
    return {
      patch: {
        recurrenceType: 'one_time',
        oneTimeStartAt: r.one_time_start_at,
        oneTimeDurationMinutes: r.one_time_duration_minutes,
        weeklyDays: null,
        weeklyStartMinute: null,
        weeklyDurationMinutes: null,
      },
    };
  }

  const days = r.weekly_days;
  if (!Array.isArray(days) || days.length === 0) return { error: 'weekly_days must be a non-empty array' };
  const uniqueDays = [...new Set(days)];
  if (uniqueDays.length !== days.length) return { error: 'weekly_days must not contain duplicates' };
  if (days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return { error: 'weekly_days must be integers 0 (Sun) through 6 (Sat)' };
  if (typeof r.weekly_start_minute !== 'number' || r.weekly_start_minute < 0 || r.weekly_start_minute > 1439) {
    return { error: 'weekly_start_minute must be 0-1439' };
  }
  if (typeof r.weekly_duration_minutes !== 'number' || r.weekly_duration_minutes < 1 || r.weekly_duration_minutes > 1439) {
    return { error: 'weekly_duration_minutes must be 1-1439' };
  }
  return {
    patch: {
      recurrenceType: 'weekly',
      oneTimeStartAt: null,
      oneTimeDurationMinutes: null,
      weeklyDays: JSON.stringify(uniqueDays),
      weeklyStartMinute: r.weekly_start_minute,
      weeklyDurationMinutes: r.weekly_duration_minutes,
    },
  };
}

function validateMinSeverity(v: unknown): { ok: true; value: Severity | null } | { error: string } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'string' || !VALID_SEVERITIES.includes(v as Severity)) {
    return { error: `min_severity must be one of ${VALID_SEVERITIES.join(', ')}, or null` };
  }
  return { ok: true, value: v as Severity };
}

async function listWithTargets(db: ReturnType<typeof drizzle<typeof schema>>) {
  const policiesList = await db.select().from(schema.patchPolicies);
  if (!policiesList.length) return [];

  const ids = policiesList.map(p => p.id);
  const [companies, devices, groups] = await Promise.all([
    db.select().from(schema.patchPolicyCompanies).where(inArray(schema.patchPolicyCompanies.policyId, ids)),
    db.select().from(schema.patchPolicyDevices).where(inArray(schema.patchPolicyDevices.policyId, ids)),
    db.select().from(schema.patchPolicyGroups).where(inArray(schema.patchPolicyGroups.policyId, ids)),
  ]);

  return policiesList.map(p => ({
    ...p,
    companyIds:   companies.filter(s => s.policyId === p.id).map(s => s.companyId),
    deviceIds: devices.filter(d => d.policyId === p.id).map(d => d.deviceId),
    groupIds:  groups.filter(g => g.policyId === p.id).map(g => g.groupId),
  }));
}

// ── GET /v1/admin/patch-policies ────────────────────────────────────────────
patchPolicies.get('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  return c.json(await listWithTargets(db));
});

// ── POST /v1/admin/patch-policies ───────────────────────────────────────────
patchPolicies.post('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  const db  = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    name?: string;
    description?: string | null;
    enabled?: boolean;
    recurrence?: RecurrenceBody;
    min_severity?: Severity | null;
    auto_reboot?: boolean;
    clone_from?: string;
  }>();

  let name        = body.name ?? '';
  let description = body.description ?? null;
  let enabled     = body.enabled ?? true;
  let minSeverity: Severity | null = null;
  let autoReboot  = body.auto_reboot ?? false;
  let recurrencePatch: Record<string, unknown> | null = null;

  let sourceCompanies:   (typeof schema.patchPolicyCompanies.$inferSelect)[]   = [];
  let sourceDevices: (typeof schema.patchPolicyDevices.$inferSelect)[] = [];
  let sourceGroups:  (typeof schema.patchPolicyGroups.$inferSelect)[]  = [];

  if (body.clone_from) {
    const source = await db.select().from(schema.patchPolicies)
      .where(eq(schema.patchPolicies.id, body.clone_from)).get();
    if (!source) return c.json({ error: 'clone_from policy not found' }, 404);

    if (!body.name)        name        = source.name;
    if (!body.description) description = source.description;
    if (body.enabled === undefined) enabled = source.enabled;
    if (body.min_severity === undefined) minSeverity = source.minSeverity as Severity | null;
    if (body.auto_reboot === undefined) autoReboot = source.autoReboot;
    if (!body.recurrence) {
      recurrencePatch = {
        recurrenceType: source.recurrenceType,
        oneTimeStartAt: source.oneTimeStartAt,
        oneTimeDurationMinutes: source.oneTimeDurationMinutes,
        weeklyDays: source.weeklyDays,
        weeklyStartMinute: source.weeklyStartMinute,
        weeklyDurationMinutes: source.weeklyDurationMinutes,
      };
    }

    [sourceCompanies, sourceDevices, sourceGroups] = await Promise.all([
      db.select().from(schema.patchPolicyCompanies).where(eq(schema.patchPolicyCompanies.policyId, source.id)),
      db.select().from(schema.patchPolicyDevices).where(eq(schema.patchPolicyDevices.policyId, source.id)),
      db.select().from(schema.patchPolicyGroups).where(eq(schema.patchPolicyGroups.policyId, source.id)),
    ]);
  }

  if (!name) return c.json({ error: 'name is required' }, 400);

  if (body.min_severity !== undefined) {
    const validated = validateMinSeverity(body.min_severity);
    if ('error' in validated) return c.json({ error: validated.error }, 400);
    minSeverity = validated.value;
  }

  if (!recurrencePatch) {
    if (!body.recurrence) return c.json({ error: 'recurrence is required' }, 400);
    const validated = validateRecurrence(body.recurrence);
    if ('error' in validated) return c.json({ error: validated.error }, 400);
    recurrencePatch = validated.patch;
  }

  const id = crypto.randomUUID();
  await db.insert(schema.patchPolicies).values({
    id, name, description, enabled,
    recurrenceType: recurrencePatch.recurrenceType as RecurrenceType,
    oneTimeStartAt: recurrencePatch.oneTimeStartAt as number | null,
    oneTimeDurationMinutes: recurrencePatch.oneTimeDurationMinutes as number | null,
    weeklyDays: recurrencePatch.weeklyDays as string | null,
    weeklyStartMinute: recurrencePatch.weeklyStartMinute as number | null,
    weeklyDurationMinutes: recurrencePatch.weeklyDurationMinutes as number | null,
    minSeverity, autoReboot,
    createdAt: now, updatedAt: now,
  });

  if (sourceCompanies.length || sourceDevices.length || sourceGroups.length) {
    await copyPatchPolicyTargets(c.env.DB, body.clone_from!, id, now);
  }

  const result = await listWithTargets(drizzle(c.env.DB, { schema }));
  const created = result.find(p => p.id === id);
  return c.json(created ?? { id }, 201);
});

// ── PATCH /v1/admin/patch-policies/:id ──────────────────────────────────────
patchPolicies.patch('/:id', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  const db  = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const id  = c.req.param('id');

  const body = await c.req.json<{
    name?: string;
    description?: string | null;
    enabled?: boolean;
    recurrence?: RecurrenceBody;
    min_severity?: Severity | null;
    auto_reboot?: boolean;
  }>();

  const patch: Record<string, unknown> = { updatedAt: now };
  if (body.name        !== undefined) patch.name        = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.enabled     !== undefined) patch.enabled     = body.enabled;
  if (body.auto_reboot  !== undefined) patch.autoReboot  = body.auto_reboot;
  if (body.min_severity !== undefined) {
    const validated = validateMinSeverity(body.min_severity);
    if ('error' in validated) return c.json({ error: validated.error }, 400);
    patch.minSeverity = validated.value;
  }
  if (body.recurrence  !== undefined) {
    const validated = validateRecurrence(body.recurrence);
    if ('error' in validated) return c.json({ error: validated.error }, 400);
    Object.assign(patch, validated.patch);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.update(schema.patchPolicies).set(patch as any).where(eq(schema.patchPolicies.id, id));

  // No reconcile needed — like Maintenance Policy, dispatch eligibility is
  // recomputed fresh from current policy state on every cron tick, not a
  // sticky flag; narrowing/disabling takes effect on the next tick.
  return c.json({ ok: true });
});

// ── DELETE /v1/admin/patch-policies/:id ─────────────────────────────────────
patchPolicies.delete('/:id', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.patchPolicies).where(eq(schema.patchPolicies.id, c.req.param('id')));
  return c.json({ ok: true });
});

// ── Companies ────────────────────────────────────────────────────────────────────
patchPolicies.get('/:id/companies', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);

  const result = await c.env.DB.prepare(
    `SELECT pps.company_id, t.name FROM patch_policy_companies pps
     JOIN companies t ON t.id = pps.company_id
     WHERE pps.policy_id = ? ORDER BY t.name ASC`
  ).bind(c.req.param('id')).all<{ company_id: string; name: string }>();

  return c.json(result.results.map(r => ({ companyId: r.company_id, name: r.name })));
});

patchPolicies.post('/:id/companies', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);
  const policyId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{ company_id?: string }>();
  if (!body.company_id) return c.json({ error: 'company_id is required' }, 400);

  const company = await c.env.DB.prepare(`SELECT id FROM companies WHERE id = ?`).bind(body.company_id).first();
  if (!company) return c.json({ error: 'company not found' }, 404);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO patch_policy_companies (policy_id, company_id, created_at) VALUES (?, ?, ?)`
  ).bind(policyId, body.company_id, now).run();

  return c.json({ ok: true }, 201);
});

patchPolicies.delete('/:id/companies/:companyId', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  await c.env.DB.prepare(
    `DELETE FROM patch_policy_companies WHERE policy_id = ? AND company_id = ?`
  ).bind(c.req.param('id'), c.req.param('companyId')).run();

  return c.json({ ok: true });
});

// ── Devices ──────────────────────────────────────────────────────────────────
patchPolicies.get('/:id/devices', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);

  const result = await c.env.DB.prepare(
    `SELECT ppd.device_id, d.hostname, t.name AS company_name FROM patch_policy_devices ppd
     JOIN devices d ON d.id = ppd.device_id
     JOIN companies t ON t.id = d.company_id
     WHERE ppd.policy_id = ? ORDER BY d.hostname ASC`
  ).bind(c.req.param('id')).all<{ device_id: string; hostname: string | null; company_name: string }>();

  return c.json(result.results.map(r => ({ deviceId: r.device_id, hostname: r.hostname, companyName: r.company_name })));
});

patchPolicies.post('/:id/devices', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);
  const policyId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{ device_id?: string }>();
  if (!body.device_id) return c.json({ error: 'device_id is required' }, 400);

  const device = await c.env.DB.prepare(`SELECT id FROM devices WHERE id = ?`).bind(body.device_id).first();
  if (!device) return c.json({ error: 'device not found' }, 404);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO patch_policy_devices (policy_id, device_id, created_at) VALUES (?, ?, ?)`
  ).bind(policyId, body.device_id, now).run();

  return c.json({ ok: true }, 201);
});

patchPolicies.delete('/:id/devices/:deviceId', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  await c.env.DB.prepare(
    `DELETE FROM patch_policy_devices WHERE policy_id = ? AND device_id = ?`
  ).bind(c.req.param('id'), c.req.param('deviceId')).run();

  return c.json({ ok: true });
});

// ── Device Groups ────────────────────────────────────────────────────────────
patchPolicies.get('/:id/groups', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly')))
    return c.json({ error: 'unauthorized' }, 401);

  const result = await c.env.DB.prepare(
    `SELECT ppg.group_id, g.name FROM patch_policy_groups ppg
     JOIN device_groups g ON g.id = ppg.group_id
     WHERE ppg.policy_id = ? ORDER BY g.name ASC`
  ).bind(c.req.param('id')).all<{ group_id: string; name: string }>();

  return c.json(result.results.map(r => ({ groupId: r.group_id, name: r.name })));
});

patchPolicies.post('/:id/groups', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);
  const policyId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{ group_id?: string }>();
  if (!body.group_id) return c.json({ error: 'group_id is required' }, 400);

  const group = await c.env.DB.prepare(`SELECT id FROM device_groups WHERE id = ?`).bind(body.group_id).first();
  if (!group) return c.json({ error: 'group not found' }, 404);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO patch_policy_groups (policy_id, group_id, created_at) VALUES (?, ?, ?)`
  ).bind(policyId, body.group_id, now).run();

  return c.json({ ok: true }, 201);
});

patchPolicies.delete('/:id/groups/:groupId', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician')))
    return c.json({ error: 'unauthorized' }, 401);

  await c.env.DB.prepare(
    `DELETE FROM patch_policy_groups WHERE policy_id = ? AND group_id = ?`
  ).bind(c.req.param('id'), c.req.param('groupId')).run();

  return c.json({ ok: true });
});

export default patchPolicies;
