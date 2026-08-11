import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import type { Bindings } from '../index';
import * as schema from '../db/schema';
import { requireUser } from '../lib/auth';
import { generateToken, sha256hex } from '../lib/crypto';
import { extendFastPoll } from '../lib/fastPoll';
import { logActivity } from '../lib/activityLog';

const sessions = new Hono<{ Bindings: Bindings }>();

// POST /v1/sessions — create a session and queue open_session for the agent
sessions.post('/', async (c) => {
  const actor = await requireUser(c.req.header('Authorization'), c.env, 'technician');
  if (!actor) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json<{
    device_id: string;
    company_id: string;
    session_type: 'shell' | 'tcp_tunnel' | 'screen_share';
    tcp_port?: number;
    // On-demand elevation for screen_share only (the "Elevate" button) --
    // ignored by the agent for every other session type. Not stored on the
    // sessions row -- a one-shot dispatch-time instruction, not queryable
    // session state, same as install_patches' own auto_reboot payload flag.
    // Needs no accompanying credentials: the agent relaunches the helper
    // with the agent service's own SYSTEM token, not an Administrator
    // token obtained from the logged-in user, so there's nothing here to
    // resolve server-side beyond the boolean itself.
    elevated?: boolean;
    // Which Windows Terminal Services session a screen_share helper
    // launches into -- omitted (the default) means the active console
    // session, exactly today's only behavior; a technician on a
    // Server-class device can instead pick a specific RDS/AVD session from
    // the list_remote_sessions picker (see DeviceDetailPage.vue) and pass
    // its session_id here. Ignored by every other session_type. Not
    // validated against a live session list server-side -- the agent's own
    // RunAsSession/RunAsSessionAsSystem already fails cleanly
    // (ErrNoActiveSession) if the session isn't actually active by the
    // time the command is picked up, same "the browser's own connect
    // timeout surfaces this" reasoning elevated already relies on.
    target_session_id?: number;
    // Which display beacon-screenshare.exe captures -- screen_share only,
    // omitted (the default) means the primary monitor, exactly today's
    // only behavior. A specific monitor's real GDI device name (e.g.
    // `\\.\DISPLAY2`, as reported via POST .../displays), chosen from
    // WebRemotePage.vue's Displays switcher.
    monitor?: string;
  }>();

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const device = await db.select({ id: schema.devices.id, inventory: schema.devices.inventory })
    .from(schema.devices)
    .where(and(
      eq(schema.devices.id, body.device_id),
      eq(schema.devices.companyId, body.company_id),
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

  // A second, separate per-session random token -- screen_share only,
  // used by the per-session beacon-screenshare.exe helper (running inside
  // the less-trusted interactive user's own session) to report its
  // enumerated monitors back via POST .../displays. Deliberately not
  // clientAuthToken/ADMIN_SECRET/the device's own long-lived credential --
  // none of those should ever reach that helper process, so this is
  // scoped narrowly to just "report this one session's display list."
  const reportToken = body.session_type === 'screen_share' ? generateToken() : undefined;

  await db.insert(schema.sessions).values({
    id: sessionId,
    deviceId: body.device_id,
    companyId: body.company_id,
    sessionType: body.session_type,
    tcpPort: body.tcp_port ?? null,
    createdAt: now,
    clientAuthHash: await sha256hex(clientAuthToken),
    reportTokenHash: reportToken ? await sha256hex(reportToken) : null,
  });

  // Signal the agent via the existing command channel — agent picks it up on next check-in
  await db.insert(schema.commands).values({
    id: crypto.randomUUID(),
    deviceId: body.device_id,
    companyId: body.company_id,
    type: 'open_session',
    payload: JSON.stringify({
      session_id: sessionId,
      session_type: body.session_type,
      ws_url: agentWsUrl,
      tcp_port: body.tcp_port ?? 0,
      elevated: body.elevated ?? false,
      ...(body.target_session_id !== undefined ? { target_session_id: body.target_session_id } : {}),
      ...(reportToken ? { report_token: reportToken } : {}),
      ...(body.monitor ? { monitor: body.monitor } : {}),
    }),
    createdAt: now,
  });

  // Opening a session is exactly the kind of "about to do work on this
  // specific machine" signal fast-poll exists for -- see
  // worker/src/lib/fastPoll.ts's own doc comment for why this is safe here
  // (single-device, technician-initiated) but deliberately never wired
  // into Job dispatch (many-device, scheduled/bulk).
  await extendFastPoll(db, body.device_id, now);

  // Explicit Layer-2 activity-log call, not left to the generic Layer-1
  // middleware (see lib/activityLog.ts) -- Layer 1 never parses the
  // request body, so it can't distinguish an ordinary screen-share/shell
  // session from an elevated one. That distinction matters more once
  // "elevated" means the agent relaunches the helper with literal SYSTEM
  // privilege (the maximum level Windows has, exceeding the old
  // Administrator-token ceiling): "technician X elevated to SYSTEM on
  // device Y at time Z" should be a first-class, searchable audit event,
  // not indistinguishable from a routine remote-support session. This
  // route is added to activityLog.ts's SKIP_ROUTES so Layer 1 doesn't
  // also log a duplicate, detail-less row for it.
  await logActivity(db, {
    actorType: actor.source === 'break-glass' ? 'break-glass' : 'user',
    actorId: actor.id,
    actorLabel: actor.email,
    category: 'Remote Session',
    action: body.elevated ? 'Opened remote session (elevated to SYSTEM)' : 'Opened remote session',
    entityType: 'device',
    entityId: body.device_id,
    companyId: body.company_id,
    method: 'POST',
    path: c.req.path,
    details: { session_type: body.session_type, elevated: body.elevated ?? false, target_session_id: body.target_session_id ?? null },
  });

  return c.json({ session_id: sessionId, client_ws_url: clientWsUrl });
});

// POST /v1/sessions/:id/displays — agent-facing: the per-session
// screen_share helper (beacon-screenshare.exe, running inside the target
// user's own desktop session) reports its enumerated monitors here right
// after startup. Authenticated by the per-session report_token (see
// POST / above), not requireUser -- there's no user session token
// available inside a helper process running on the target machine, and
// this must never accept the device's own long-lived credential either
// (that would leak it into a less-trusted interactive-session process).
sessions.post('/:id/displays', async (c) => {
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : undefined;
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const row = await db.select({ hash: schema.sessions.reportTokenHash })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, c.req.param('id')))
    .get();
  if (!row?.hash || (await sha256hex(token)) !== row.hash) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json<{ displays: unknown }>();
  if (!Array.isArray(body.displays)) return c.json({ error: 'displays must be an array' }, 400);

  await db.update(schema.sessions)
    .set({ displays: JSON.stringify(body.displays) })
    .where(eq(schema.sessions.id, c.req.param('id')));

  return c.json({ ok: true });
});

// GET /v1/sessions/:id/displays — technician-facing: the dashboard polls
// this a handful of times shortly after connecting to populate the
// monitor switcher, once the screen_share helper above has reported in
// (typically within a second or two of the session actually being open --
// GDI monitor enumeration is near-instant, unlike waiting on a check-in
// cycle). Returns an empty array, not an error, until the helper has
// reported (or if it never does, e.g. a non-Windows target).
sessions.get('/:id/displays', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = drizzle(c.env.DB, { schema });
  const row = await db.select({ displays: schema.sessions.displays })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, c.req.param('id')))
    .get();
  if (!row) return c.json({ error: 'session not found' }, 404);
  let displays: unknown[] = [];
  try { displays = row.displays ? JSON.parse(row.displays) : []; } catch { /* malformed -- treat as not yet reported */ }
  return c.json({ displays });
});

// POST /v1/sessions/:id/switch-monitor — technician-facing: requests an
// in-place monitor switch on an already-open screen_share session, without
// tearing it down. Replaces this feature's original design (opening a
// brand-new session per switch, via the report_token/displays machinery
// above), which real-hardware testing found took 10+ seconds per switch --
// an inherent floor from a fresh relay Durable Object plus the
// check-in-cycle-bound open_session dispatch. This route is just a cheap
// pointer write; the actual switch happens when the already-running
// beacon-screenshare.exe helper (see GET below) notices the change on its
// own short poll interval and swaps its live Capturer/Injector in place
// (agent/internal/rfbserver's SwitchRequest), pushing an RFB DesktopSize
// pseudo-encoding update so the already-connected noVNC client resizes
// without reconnecting.
sessions.post('/:id/switch-monitor', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = await c.req.json<{ monitor: string }>();
  if (!body.monitor) return c.json({ error: 'monitor is required' }, 400);

  const db = drizzle(c.env.DB, { schema });
  const row = await db.select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, c.req.param('id')))
    .get();
  if (!row) return c.json({ error: 'session not found' }, 404);

  await db.update(schema.sessions)
    .set({ pendingMonitor: body.monitor })
    .where(eq(schema.sessions.id, c.req.param('id')));

  return c.json({ ok: true });
});

// GET /v1/sessions/:id/switch-monitor — agent-facing: the already-running
// screen_share helper polls this at a short interval (much faster than a
// check-in cycle -- see the route above) to notice a requested switch.
// Authenticated the same way as GET/POST .../displays -- the per-session
// report_token, not requireUser or the device's own long-lived credential.
// Always returns the current pointer verbatim, even if the helper already
// applied it -- the helper, not this route, tracks "did I already apply
// this," so there's nothing here to consume/clear.
sessions.get('/:id/switch-monitor', async (c) => {
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : undefined;
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const row = await db.select({ hash: schema.sessions.reportTokenHash, monitor: schema.sessions.pendingMonitor })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, c.req.param('id')))
    .get();
  if (!row?.hash || (await sha256hex(token)) !== row.hash) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  return c.json({ monitor: row.monitor ?? '' });
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
