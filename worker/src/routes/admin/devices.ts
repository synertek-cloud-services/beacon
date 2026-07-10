import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';

const adminDevices = new Hono<{ Bindings: Bindings }>();

function auth(c: any): boolean {
  const header = c.req.header('Authorization');
  return header === `Bearer ${c.env.ADMIN_SECRET}`;
}

// GET /v1/admin/devices?status=pending|approved|revoked
adminDevices.get('/', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const statusFilter = c.req.query('status') as typeof schema.devices.$inferSelect['status'] | undefined;

  const rows = statusFilter
    ? await db.select().from(schema.devices).where(eq(schema.devices.status, statusFilter)).all()
    : await db.select().from(schema.devices).all();

  return c.json(rows);
});

// GET /v1/admin/devices/:id
adminDevices.get('/:id', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const device = await db.select().from(schema.devices).where(eq(schema.devices.id, c.req.param('id'))).get();
  if (!device) return c.json({ error: 'not found' }, 404);
  return c.json(device);
});

// POST /v1/admin/devices/:id/approve
adminDevices.post('/:id/approve', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const result = await db
    .update(schema.devices)
    .set({ status: 'approved', approvedAt: now })
    .where(eq(schema.devices.id, c.req.param('id')));

  return c.json({ ok: true });
});

// POST /v1/admin/devices/:id/revoke
adminDevices.post('/:id/revoke', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });

  await db
    .update(schema.devices)
    .set({ status: 'revoked' })
    .where(eq(schema.devices.id, c.req.param('id')));

  return c.json({ ok: true });
});

// DELETE /v1/admin/devices/:id
adminDevices.delete('/:id', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.devices).where(eq(schema.devices.id, c.req.param('id')));

  return c.json({ ok: true });
});

// GET /v1/admin/devices/:id/commands — list recent commands (newest first)
adminDevices.get('/:id/commands', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const cmds = await db
    .select()
    .from(schema.commands)
    .where(eq(schema.commands.deviceId, c.req.param('id')))
    .all();

  // Return newest first
  return c.json(cmds.sort((a, b) => b.createdAt - a.createdAt));
});

// POST /v1/admin/devices/:id/commands — queue a command for the device
adminDevices.post('/:id/commands', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const deviceId = c.req.param('id');

  const device = await db
    .select({ id: schema.devices.id, tenantId: schema.devices.tenantId, status: schema.devices.status, osType: schema.devices.osType })
    .from(schema.devices)
    .where(eq(schema.devices.id, deviceId))
    .get();

  if (!device)                   return c.json({ error: 'device not found' }, 404);
  if (device.status !== 'approved') return c.json({ error: 'device must be approved to receive commands' }, 400);

  const body = await c.req.json<{
    type: 'run_script' | 'reboot';
    shell?: string;
    script?: string;
    timeout_seconds?: number;
  }>();

  let cmdType = 'run_script';
  let payload: Record<string, unknown>;

  if (body.type === 'reboot') {
    // Resolve OS-appropriate reboot command
    const rebootScript =
      device.osType === 'windows' ? 'shutdown /r /t 0' :
      device.osType === 'darwin'  ? 'shutdown -r now'  : 'reboot';
    const shell = device.osType === 'windows' ? 'powershell' : 'bash';
    payload = { shell, script: rebootScript, timeout_seconds: 30 };
  } else if (body.type === 'run_script') {
    if (!body.script?.trim()) return c.json({ error: 'script is required' }, 400);
    // Resolve 'auto' shell
    const shell = body.shell === 'auto' || !body.shell
      ? (device.osType === 'windows' ? 'powershell' : 'bash')
      : body.shell;
    payload = { shell, script: body.script.trim(), timeout_seconds: body.timeout_seconds ?? 300 };
  } else {
    return c.json({ error: 'unknown command type' }, 400);
  }

  const id = crypto.randomUUID();
  await db.insert(schema.commands).values({
    id,
    deviceId,
    tenantId: device.tenantId,
    type: cmdType,
    payload: JSON.stringify(payload),
    status: 'queued',
    createdAt: now,
  });

  return c.json({ id }, 201);
});

// GET /v1/admin/devices/:id/audit/latest
adminDevices.get('/:id/audit/latest', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const row = await db.select()
    .from(schema.deviceAudits)
    .where(eq(schema.deviceAudits.deviceId, c.req.param('id')))
    .orderBy(desc(schema.deviceAudits.createdAt))
    .limit(1)
    .get();

  if (!row) return c.json(null);

  return c.json({
    id:           row.id,
    deviceId:     row.deviceId,
    tenantId:     row.tenantId,
    auditType:    row.auditType,
    agentVersion: row.agentVersion,
    createdAt:    row.createdAt,
    hardware:     row.hardware  ? JSON.parse(row.hardware)  : null,
    software:     row.software  ? JSON.parse(row.software)  : null,
    services:     row.services  ? JSON.parse(row.services)  : null,
    security:     row.security  ? JSON.parse(row.security)  : null,
  });
});

// GET /v1/admin/devices/:id/audit/changes?limit=100
adminDevices.get('/:id/audit/changes', async (c) => {
  if (!auth(c)) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);

  const rows = await db.select()
    .from(schema.deviceAuditChanges)
    .where(eq(schema.deviceAuditChanges.deviceId, c.req.param('id')))
    .orderBy(desc(schema.deviceAuditChanges.detectedAt))
    .limit(limit)
    .all();

  return c.json(rows);
});

export default adminDevices;
