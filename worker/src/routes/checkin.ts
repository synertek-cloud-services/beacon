import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../index';
import * as schema from '../db/schema';
import type { CheckInRequest, CheckInResponse } from '../lib/types';
import { sha256hex } from '../lib/crypto';

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

  // Pending devices: accept data for visibility, return no commands
  if (device.status === 'pending') {
    return c.json<CheckInResponse>({});
  }

  // Phase 2: process body.pending_command_results and fetch queued commands
  return c.json<CheckInResponse>({ commands: [] });
});

export default checkin;
