import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import type { Bindings } from '../index';
import * as schema from '../db/schema';
import { requireUser } from '../lib/auth';
import { generateToken, sha256hex } from '../lib/crypto';

const sessions = new Hono<{ Bindings: Bindings }>();

// POST /v1/sessions — create a session and queue open_session for the agent
sessions.post('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json<{
    device_id: string;
    tenant_id: string;
    session_type: 'shell' | 'tcp_tunnel';
    tcp_port?: number;
  }>();

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const device = await db.select({ id: schema.devices.id, inventory: schema.devices.inventory })
    .from(schema.devices)
    .where(and(
      eq(schema.devices.id, body.device_id),
      eq(schema.devices.tenantId, body.tenant_id),
      eq(schema.devices.status, 'approved'),
    ))
    .get();

  if (!device) return c.json({ error: 'device not found or not approved' }, 404);
  try {
    if (JSON.parse(device.inventory ?? '{}').demo_seed === true) {
      return c.json({ error: 'remote sessions are unavailable for seeded demo devices' }, 409);
    }
  } catch { /* a malformed inventory blob is not a reason to block a real device */ }

  const sessionId = crypto.randomUUID();
  // WORKER_URL is a configured value, not derived from c.req.url — a
  // [[routes]] custom-domain block in wrangler.toml can make the request's
  // own URL reflect the production route even under `wrangler dev`, which
  // would otherwise send local-dev sessions to the real production worker.
  const origin = new URL(c.env.WORKER_URL).origin.replace(/^http/, 'ws');
  const agentWsUrl  = `${origin}/v1/sessions/${sessionId}/ws?role=agent`;

  // Per-session random client auth token — not the shared ADMIN_SECRET, since
  // technicians who open sessions never hold it.
  const clientAuthToken = generateToken();
  const clientWsUrl = `${origin}/v1/sessions/${sessionId}/ws?role=client&auth=${clientAuthToken}`;

  await db.insert(schema.sessions).values({
    id: sessionId,
    deviceId: body.device_id,
    tenantId: body.tenant_id,
    sessionType: body.session_type,
    tcpPort: body.tcp_port ?? null,
    createdAt: now,
    clientAuthHash: await sha256hex(clientAuthToken),
  });

  // Signal the agent via the existing command channel — agent picks it up on next check-in
  await db.insert(schema.commands).values({
    id: crypto.randomUUID(),
    deviceId: body.device_id,
    tenantId: body.tenant_id,
    type: 'open_session',
    payload: JSON.stringify({
      session_id: sessionId,
      session_type: body.session_type,
      ws_url: agentWsUrl,
      tcp_port: body.tcp_port ?? 0,
    }),
    createdAt: now,
  });

  return c.json({ session_id: sessionId, client_ws_url: clientWsUrl });
});

// GET /v1/sessions/:id/ws — WebSocket upgrade, proxied to the SessionRelay DO
sessions.get('/:id/ws', async (c) => {
  const role = c.req.query('role');
  if (role !== 'agent' && role !== 'client') {
    return c.json({ error: 'role must be agent or client' }, 400);
  }

  if (role === 'client') {
    const auth = c.req.query('auth');
    const db = drizzle(c.env.DB, { schema });
    const row = await db.select({ hash: schema.sessions.clientAuthHash })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, c.req.param('id')))
      .get();
    if (!auth || !row?.hash || (await sha256hex(auth)) !== row.hash) {
      return c.json({ error: 'unauthorized' }, 401);
    }
  }

  const doId = c.env.SESSION.idFromName(c.req.param('id'));
  return c.env.SESSION.get(doId).fetch(c.req.raw);
});

export default sessions;
