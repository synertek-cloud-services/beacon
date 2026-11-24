import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db';
import * as schema from '../db/schema';
import type { Bindings } from '../index';
import { sha256hex } from '../lib/crypto';

const agentWs = new Hono<{ Bindings: Bindings }>();

// The agent's wake channel. Authenticated with the same device credential as
// check-in, then handed to that device's DeviceHub Durable Object.
agentWs.get('/', async (c) => {
  if (!c.env.DEVICE_HUB) return c.json({ error: 'not available' }, 404);
  if (c.req.header('Upgrade') !== 'websocket') return c.json({ error: 'WebSocket upgrade required' }, 426);

  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return c.json({ error: 'missing authorization' }, 401);
  const device = await getDb(c.env.DB).select({ id: schema.devices.id, status: schema.devices.status })
    .from(schema.devices)
    .where(eq(schema.devices.deviceCredentialHash, await sha256hex(auth.slice(7))))
    .get();
  if (!device) return c.json({ error: 'unknown device' }, 401);
  if (device.status === 'revoked') return c.json({ error: 'device revoked' }, 403);

  const stub = c.env.DEVICE_HUB.get(c.env.DEVICE_HUB.idFromName(device.id));
  return stub.fetch(c.req.raw);
});

export default agentWs;
