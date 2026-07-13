import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import type { Bindings } from '../index';
import * as schema from '../db/schema';
import type { CheckInRequest, CheckInResponse } from '../lib/types';
import { sha256hex } from '../lib/crypto';
import { evaluateCheckinAlerts, evaluateFileSizeAlerts, evaluatePingAlerts, evaluateProcessAlerts, evaluateServiceAlerts } from '../lib/alerts';

const checkin = new Hono<{ Bindings: Bindings }>();

checkin.post('/', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'missing authorization' }, 401);
  }
  const credentialHash = await sha256hex(auth.slice(7));

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const device = await db.select()
    .from(schema.devices)
    .where(eq(schema.devices.deviceCredentialHash, credentialHash))
    .get();

  if (!device) return c.json({ error: 'unknown device' }, 401);
  if (device.status === 'revoked') return c.json({ error: 'device revoked' }, 403);

  let body: CheckInRequest;
  try {
    body = await c.req.json<CheckInRequest>();
  } catch {
    return c.json({ error: 'invalid request body' }, 400);
  }

  if (body.device_id !== device.id || body.tenant_id !== device.tenantId) {
    return c.json({ error: 'device_id or tenant_id mismatch' }, 403);
  }

  // detected_class is always recomputed from agent signals — never touches override_class
  await db.update(schema.devices)
    .set({
      lastSeen: now,
      agentVersion: body.agent_version,
      hostname: body.metrics.hostname,
      osType: body.metrics.os_type,
      osVersion: body.metrics.os_version,
      detectedClass: body.metrics.detected_class,
      inventory: JSON.stringify(body.metrics),
    })
    .where(eq(schema.devices.id, device.id));

  // Process results from previously issued commands
  if (body.pending_command_results?.length) {
    const ids = body.pending_command_results.map(r => r.command_id);
    const owned = await db.select({ id: schema.commands.id })
      .from(schema.commands)
      .where(and(
        inArray(schema.commands.id, ids),
        eq(schema.commands.deviceId, device.id),
      ));
    const ownedIds = new Set(owned.map(r => r.id));

    for (const r of body.pending_command_results) {
      if (!ownedIds.has(r.command_id)) continue; // ignore results for commands not belonging to this device
      await db.update(schema.commands)
        .set({
          status: r.status,
          result: JSON.stringify({ stdout: r.stdout, stderr: r.stderr, exit_code: r.exit_code }),
          completedAt: now,
        })
        .where(eq(schema.commands.id, r.command_id));
    }
  }

  // Evaluate in-band alert checks (disk_space, etc.) against fresh inventory
  const { fileSizeChecks, pingChecks, processChecks, serviceChecks } = await evaluateCheckinAlerts(c.env.DB, device, body.metrics, now);

  // Evaluate file_size measurements the agent took for a prior check-in's assignments
  if (body.pending_file_size_results?.length) {
    await evaluateFileSizeAlerts(c.env.DB, device, body.pending_file_size_results, now);
  }

  // Evaluate ping measurements the agent took for a prior check-in's assignments
  if (body.pending_ping_results?.length) {
    await evaluatePingAlerts(c.env.DB, device, body.pending_ping_results, now);
  }

  // Evaluate process measurements the agent took for a prior check-in's assignments
  if (body.pending_process_results?.length) {
    await evaluateProcessAlerts(c.env.DB, device, body.pending_process_results, now);
  }

  // Evaluate service measurements the agent took for a prior check-in's assignments
  if (body.pending_service_results?.length) {
    await evaluateServiceAlerts(c.env.DB, device, body.pending_service_results, now);
  }

  // Pending devices: accept data for visibility, return no commands
  if (device.status === 'pending') {
    return c.json<CheckInResponse>({});
  }

  // Fetch queued commands and mark them sent
  const queued = await db.select()
    .from(schema.commands)
    .where(and(
      eq(schema.commands.deviceId, device.id),
      eq(schema.commands.status, 'queued'),
    ))
    .limit(10);

  if (queued.length > 0) {
    await db.update(schema.commands)
      .set({ status: 'sent' })
      .where(inArray(schema.commands.id, queued.map(c => c.id)));
  }

  return c.json<CheckInResponse>({
    commands: queued.map(cmd => ({
      command_id: cmd.id,
      type: cmd.type,
      payload: JSON.parse(cmd.payload),
    })),
    file_size_checks: fileSizeChecks.length ? fileSizeChecks : undefined,
    ping_checks: pingChecks.length ? pingChecks : undefined,
    process_checks: processChecks.length ? processChecks : undefined,
    service_checks: serviceChecks.length ? serviceChecks : undefined,
  });
});

export default checkin;
