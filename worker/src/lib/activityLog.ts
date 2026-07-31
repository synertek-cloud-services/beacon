import { drizzle } from 'drizzle-orm/d1';
import { eq, lt } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import type { Bindings } from '../index';
import * as schema from '../db/schema';
import { requireUser } from './auth';

type Db = ReturnType<typeof drizzle<typeof schema>>;

// ── Low-level insert ────────────────────────────────────────────────────────

export interface LogActivityParams {
  actorType: 'user' | 'system' | 'break-glass';
  actorId?: string | null;
  actorLabel?: string | null;
  category: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  companyId?: string | null;
  method: string;
  path?: string | null;
  details?: unknown; // JSON-stringified if present
}

export async function logActivity(db: Db, p: LogActivityParams): Promise<void> {
  await db.insert(schema.activityLog).values({
    id: crypto.randomUUID(),
    createdAt: Math.floor(Date.now() / 1000),
    actorType: p.actorType,
    actorId: p.actorId ?? null,
    actorLabel: p.actorLabel ?? null,
    category: p.category,
    action: p.action,
    entityType: p.entityType ?? null,
    entityId: p.entityId ?? null,
    companyId: p.companyId ?? null,
    method: p.method,
    path: p.path ?? null,
    details: p.details !== undefined ? JSON.stringify(p.details) : null,
  });
}

// ── Layer 1: generic middleware ─────────────────────────────────────────────
//
// Wraps /v1/admin/*, /v1/auth/*, /v1/sessions(/*), /v1/branding/* (registered
// in index.ts, before the app.route() mounts, same ordering corsMiddleware
// already uses for these same prefixes). After a successful (2xx) mutating
// (POST/PATCH/PUT/DELETE) request, resolves the actor and a human label and
// writes one activity_log row. Every mutating route gets *something* logged
// -- routes not in FINE_GRAINED below still get a generic label derived from
// their mount prefix, so a route added later with no lookup-table entry
// isn't silently dropped.
//
// Deliberately does NOT try to read c.get('authedUser') set by the route's
// own auth check -- requireUser() never receives the Hono Context at all
// (every call site passes discrete primitives), so there's nothing to read.
// Instead this resolves the actor itself, a second time, but ONLY on
// successful mutations -- one extra cheap D1 session lookup, not on every
// request.

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// Routes covered by an explicit Layer-2 logActivity() call elsewhere (see
// routes/auth.ts, routes/auth-microsoft.ts) -- logging them here too would
// either produce a useless actor-less duplicate (no Authorization header
// exists yet at login) or double-count the same login event.
const SKIP_ROUTES = new Set<string>([
  'POST /v1/auth/login',
  'POST /v1/auth/microsoft/exchange',
]);

interface PrefixDefault {
  prefix: string;
  category: string;
  noun: string; // used to build the generic fallback label, e.g. "Created device"
  entityType: string | null; // used both for the fallback entityType and the UI's live-join key
}

// Longest-prefix-wins matching (e.g. '/v1/auth/microsoft' must be checked
// before the bare '/v1/auth' entry) -- order here doesn't matter, matchPrefix
// always picks the longest matching prefix itself.
const PREFIX_DEFAULTS: PrefixDefault[] = [
  { prefix: '/v1/admin/companies',             category: 'Company',             noun: 'company',    entityType: 'company' },
  { prefix: '/v1/admin/devices',              category: 'Device',              noun: 'device',     entityType: 'device' },
  { prefix: '/v1/admin/commands',             category: 'Command',             noun: 'command',    entityType: null },
  { prefix: '/v1/admin/policies',              category: 'Policy',              noun: 'policy',     entityType: 'policy' },
  { prefix: '/v1/admin/alerts',                category: 'Alert',               noun: 'alert',      entityType: 'alert' },
  { prefix: '/v1/admin/webhooks',              category: 'Webhook',             noun: 'webhook',    entityType: 'webhook' },
  { prefix: '/v1/admin/email-settings',        category: 'Email Settings',      noun: 'setting',    entityType: null },
  { prefix: '/v1/admin/notification-emails',   category: 'Notification Email',  noun: 'recipient',  entityType: 'notificationEmail' },
  { prefix: '/v1/admin/agent/versions',        category: 'Agent Version',       noun: 'version',    entityType: 'agentVersion' },
  { prefix: '/v1/admin/components',            category: 'Component',           noun: 'component',  entityType: 'component' },
  { prefix: '/v1/admin/jobs',                  category: 'Job',                  noun: 'job',        entityType: 'job' },
  { prefix: '/v1/admin/users',                 category: 'User',                 noun: 'user',       entityType: 'user' },
  { prefix: '/v1/admin/sso',                   category: 'SSO',                  noun: 'provider',   entityType: 'ssoProvider' },
  { prefix: '/v1/admin/custom-fields',         category: 'Custom Field',         noun: 'field',      entityType: 'customField' },
  { prefix: '/v1/admin/groups',                category: 'Device Group',         noun: 'group',      entityType: 'group' },
  { prefix: '/v1/admin/dashboards',            category: 'Dashboard',            noun: 'dashboard',  entityType: 'dashboard' },
  { prefix: '/v1/admin/maintenance-policies',  category: 'Maintenance Policy',   noun: 'policy',     entityType: 'maintenancePolicy' },
  { prefix: '/v1/admin/patches',               category: 'Patch',                noun: 'patch',      entityType: 'patch' },
  { prefix: '/v1/admin/patch-policies',        category: 'Patch Policy',         noun: 'policy',     entityType: 'patchPolicy' },
  { prefix: '/v1/admin/settings',              category: 'Settings',             noun: 'setting',    entityType: null },
  { prefix: '/v1/auth/microsoft',              category: 'SSO',                  noun: 'session',    entityType: null },
  { prefix: '/v1/auth',                        category: 'Auth',                 noun: 'session',    entityType: null },
  { prefix: '/v1/sessions',                    category: 'Remote Session',       noun: 'session',    entityType: 'device' },
  { prefix: '/v1/branding',                    category: 'Branding',             noun: 'setting',    entityType: null },
];

function matchPrefix(routePath: string): PrefixDefault | null {
  let best: PrefixDefault | null = null;
  for (const p of PREFIX_DEFAULTS) {
    if ((routePath === p.prefix || routePath.startsWith(p.prefix + '/')) && (!best || p.prefix.length > best.prefix.length)) {
      best = p;
    }
  }
  return best;
}

function humanizeSegment(seg: string): string {
  return seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Fallback label for any (method, routePath) not in FINE_GRAINED below. Only
// a POST whose trailing segment is a literal action word immediately after
// a ":param" (e.g. '/:id/approve', '/:id/publish') gets humanized directly
// -- a POST against a bare collection root (e.g. '/v1/admin/companies', whose
// trailing segment is just the collection's own name, not an action verb)
// is treated as a create, same as a ':id'-shaped trailing segment.
function fallbackLabel(method: string, routePath: string, noun: string): string {
  if (method === 'DELETE') return `Deleted ${noun}`;
  if (method === 'PATCH' || method === 'PUT') return `Updated ${noun}`;
  const segments = routePath.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  const secondLast = segments[segments.length - 2];
  const isNestedAction = !!last && !last.startsWith(':') && !!secondLast && secondLast.startsWith(':');
  if (isNestedAction) return `${humanizeSegment(last)} ${noun}`;
  return `Created ${noun}`;
}

// Fine-grained (method, routePath) -> nicer label / category / entityType
// override. idParam names the Hono path param to use as entityId when it
// isn't literally ":id" (only one route in this codebase needs this --
// GET/PATCH /v1/admin/patches/:updateId has no ":id" param at all).
interface FineGrainedEntry {
  category?: string;
  action: string;
  entityType?: string | null;
  idParam?: string;
}

const FINE_GRAINED: Record<string, FineGrainedEntry> = {
  'POST /v1/admin/companies':                                   { action: 'Created company', entityType: 'company' },
  'PATCH /v1/admin/companies/:id':                              { action: 'Edited company', entityType: 'company' },
  'POST /v1/admin/companies/:id/contacts':                      { action: 'Added company contact', entityType: 'company' },
  'PATCH /v1/admin/companies/:id/contacts/:contactId':          { action: 'Edited company contact', entityType: 'company' },
  'DELETE /v1/admin/companies/:id/contacts/:contactId':         { action: 'Removed company contact', entityType: 'company' },
  'POST /v1/admin/companies/:id/locations':                     { action: 'Added company location', entityType: 'company' },
  'PATCH /v1/admin/companies/:id/locations/:locationId':        { action: 'Edited company location', entityType: 'company' },
  'DELETE /v1/admin/companies/:id/locations/:locationId':       { action: 'Removed company location', entityType: 'company' },
  'POST /v1/admin/companies/:id/tokens':                        { action: 'Created enrollment token', entityType: 'company' },
  'DELETE /v1/admin/companies/:id/tokens/:tokenId':              { action: 'Revoked enrollment token', entityType: 'company' },
  'DELETE /v1/admin/companies/:id/tokens/:tokenId/permanent':   { action: 'Deleted enrollment token', entityType: 'company' },

  'POST /v1/admin/devices/:id/approve':                       { action: 'Approved device', entityType: 'device' },
  'POST /v1/admin/devices/:id/revoke':                        { action: 'Revoked device', entityType: 'device' },
  'DELETE /v1/admin/devices/:id':                             { action: 'Deleted device', entityType: 'device' },
  'PATCH /v1/admin/devices/:id':                               { action: 'Edited device', entityType: 'device' },
  'POST /v1/admin/devices/:id/commands':                      { action: 'Queued device command', entityType: 'device' },
  'POST /v1/admin/devices/:id/maintenance':                   { action: 'Started maintenance window', entityType: 'device' },
  'DELETE /v1/admin/devices/:id/maintenance':                 { action: 'Ended maintenance window', entityType: 'device' },
  'PATCH /v1/admin/devices/:id/custom-fields/:fieldId':       { action: 'Set device custom field', entityType: 'device' },

  'POST /v1/admin/alerts/:id/resolve':                        { action: 'Resolved alert', entityType: 'alert' },
  'POST /v1/admin/alerts/:id/acknowledge':                    { action: 'Acknowledged alert', entityType: 'alert' },

  'POST /v1/admin/policies':                                  { action: 'Created policy', entityType: 'policy' },
  'PATCH /v1/admin/policies/:id':                              { action: 'Edited policy', entityType: 'policy' },
  'DELETE /v1/admin/policies/:id':                            { action: 'Deleted policy', entityType: 'policy' },
  'POST /v1/admin/policies/:id/monitors':                     { action: 'Added monitor', entityType: 'policy' },
  'PATCH /v1/admin/policies/:id/monitors/:mid':               { action: 'Edited monitor', entityType: 'policy' },
  'DELETE /v1/admin/policies/:id/monitors/:mid':              { action: 'Removed monitor', entityType: 'policy' },
  'POST /v1/admin/policies/:id/sites':                        { action: 'Added policy site target', entityType: 'policy' },
  'DELETE /v1/admin/policies/:id/sites/:companyId':            { action: 'Removed policy site target', entityType: 'policy' },
  'POST /v1/admin/policies/:id/devices':                      { action: 'Added policy device target', entityType: 'policy' },
  'DELETE /v1/admin/policies/:id/devices/:deviceId':          { action: 'Removed policy device target', entityType: 'policy' },
  'POST /v1/admin/policies/:id/groups':                       { action: 'Added policy group target', entityType: 'policy' },
  'DELETE /v1/admin/policies/:id/groups/:groupId':            { action: 'Removed policy group target', entityType: 'policy' },

  'POST /v1/admin/jobs':                                      { action: 'Created job', entityType: 'job' },
  'DELETE /v1/admin/jobs/:id':                                { action: 'Retired job', entityType: 'job' },
  'DELETE /v1/admin/jobs/:id/purge':                          { action: 'Purged job', entityType: 'job' },

  'POST /v1/admin/components':                                { action: 'Created component', entityType: 'component' },
  'PATCH /v1/admin/components/:id':                           { action: 'Edited component', entityType: 'component' },
  'DELETE /v1/admin/components/:id':                          { action: 'Deleted component', entityType: 'component' },
  'POST /v1/admin/components/:id/clone':                      { action: 'Cloned component', entityType: 'component' },

  'POST /v1/auth/logout':                                     { category: 'Auth', action: 'Logged out' },

  'POST /v1/admin/branding/themes':                           { category: 'Branding', action: 'Created theme', entityType: 'theme' },
  'PATCH /v1/admin/branding/themes/:id':                      { category: 'Branding', action: 'Edited theme', entityType: 'theme' },
  'DELETE /v1/admin/branding/themes/:id':                     { category: 'Branding', action: 'Deleted theme', entityType: 'theme' },
  'POST /v1/admin/branding/themes/:id/publish':               { category: 'Branding', action: 'Published theme', entityType: 'theme' },
  'POST /v1/admin/branding/themes/:id/activate':              { category: 'Branding', action: 'Activated theme', entityType: 'theme' },
  'POST /v1/admin/branding/revisions/:id/activate':           { category: 'Branding', action: 'Activated theme revision', entityType: 'theme' },
  'PATCH /v1/branding/admin/identity':                        { category: 'Branding', action: 'Edited product identity' },
  'POST /v1/branding/admin/logo':                             { category: 'Branding', action: 'Uploaded logo' },
  'DELETE /v1/branding/admin/logo':                           { category: 'Branding', action: 'Removed logo' },

  'POST /v1/admin/users':                                     { action: 'Created user', entityType: 'user' },
  'PATCH /v1/admin/users/:id':                                { action: 'Edited user', entityType: 'user' },
  'POST /v1/admin/users/:id/reset-password':                  { action: 'Reset user password', entityType: 'user' },
  'DELETE /v1/admin/users/:id':                               { action: 'Disabled user', entityType: 'user' },

  'POST /v1/admin/sso/providers':                             { category: 'SSO', action: 'Created SSO provider', entityType: 'ssoProvider' },
  'PATCH /v1/admin/sso/providers/:id':                        { category: 'SSO', action: 'Edited SSO provider', entityType: 'ssoProvider' },
  'DELETE /v1/admin/sso/providers/:id':                       { category: 'SSO', action: 'Removed SSO provider', entityType: 'ssoProvider' },
  'POST /v1/admin/sso/providers/:id/group-mappings':          { category: 'SSO', action: 'Added group mapping', entityType: 'ssoProvider' },
  'DELETE /v1/admin/sso/providers/:id/group-mappings/:mid':   { category: 'SSO', action: 'Removed group mapping', entityType: 'ssoProvider' },

  'POST /v1/admin/webhooks':                                  { action: 'Created webhook', entityType: 'webhook' },
  'PATCH /v1/admin/webhooks/:id':                             { action: 'Edited webhook', entityType: 'webhook' },
  'DELETE /v1/admin/webhooks/:id':                            { action: 'Deleted webhook', entityType: 'webhook' },
  'PATCH /v1/admin/email-settings':                           { action: 'Edited email settings' },
  'POST /v1/admin/notification-emails':                       { action: 'Added notification recipient' },
  'PATCH /v1/admin/notification-emails/:id':                  { action: 'Edited notification recipient' },
  'DELETE /v1/admin/notification-emails/:id':                 { action: 'Removed notification recipient' },

  'POST /v1/admin/custom-fields':                             { action: 'Created custom field', entityType: 'customField' },
  'PATCH /v1/admin/custom-fields/:id':                        { action: 'Edited custom field', entityType: 'customField' },
  'DELETE /v1/admin/custom-fields/:id':                       { action: 'Deleted custom field', entityType: 'customField' },

  'POST /v1/admin/groups':                                    { action: 'Created device group', entityType: 'group' },
  'PATCH /v1/admin/groups/:id':                               { action: 'Edited device group', entityType: 'group' },
  'DELETE /v1/admin/groups/:id':                              { action: 'Deleted device group', entityType: 'group' },
  'POST /v1/admin/groups/:id/members':                        { action: 'Added group member', entityType: 'group' },
  'POST /v1/admin/groups/:id/members/bulk':                   { action: 'Bulk-added group members', entityType: 'group' },
  'DELETE /v1/admin/groups/:id/members/:deviceId':            { action: 'Removed group member', entityType: 'group' },

  'POST /v1/admin/dashboards':                                { action: 'Created dashboard', entityType: 'dashboard' },
  'PATCH /v1/admin/dashboards/:id':                           { action: 'Edited dashboard', entityType: 'dashboard' },
  'DELETE /v1/admin/dashboards/:id':                          { action: 'Deleted dashboard', entityType: 'dashboard' },

  'POST /v1/admin/maintenance-policies':                      { action: 'Created maintenance policy', entityType: 'maintenancePolicy' },
  'PATCH /v1/admin/maintenance-policies/:id':                 { action: 'Edited maintenance policy', entityType: 'maintenancePolicy' },
  'DELETE /v1/admin/maintenance-policies/:id':                { action: 'Deleted maintenance policy', entityType: 'maintenancePolicy' },

  'PATCH /v1/admin/patches/:updateId':                        { action: 'Set patch approval status', entityType: 'patch', idParam: 'updateId' },

  'POST /v1/admin/patch-policies':                            { action: 'Created patch policy', entityType: 'patchPolicy' },
  'PATCH /v1/admin/patch-policies/:id':                       { action: 'Edited patch policy', entityType: 'patchPolicy' },
  'DELETE /v1/admin/patch-policies/:id':                      { action: 'Deleted patch policy', entityType: 'patchPolicy' },

  'PATCH /v1/admin/settings':                                 { action: 'Edited host settings' },

  'POST /v1/sessions':                                        { category: 'Remote Session', action: 'Opened remote session' },
};

export async function activityLogMiddleware(c: Context<{ Bindings: Bindings; Variables: { activityLogWritten?: boolean } }>, next: Next): Promise<void> {
  await next();

  // A single request path can match more than one registered prefix (e.g.
  // both '/v1/sessions' and '/v1/sessions/*' match the bare '/v1/sessions'
  // path) -- each match becomes its own layer in Hono's onion chain, so
  // without this guard the same request logs once per matching layer.
  // Confirmed via a real duplicate row during local testing, not assumed.
  if (c.get('activityLogWritten')) return;

  const method = c.req.method;
  if (!MUTATING_METHODS.has(method)) return;
  if (!c.res || c.res.status < 200 || c.res.status >= 300) return;

  c.set('activityLogWritten', true);

  // Must read routePath/param AFTER next() -- Hono's compose() leaves
  // routeIndex pointing at whichever layer most recently dispatched, so
  // reading these before next() would give this middleware's own
  // registration pattern instead of the terminal handler's matched route.
  const routePath = c.req.routePath;
  const key = `${method} ${routePath}`;
  if (SKIP_ROUTES.has(key)) return;

  const fine = FINE_GRAINED[key];
  const prefixInfo = matchPrefix(routePath);
  const noun = prefixInfo?.noun ?? 'item';
  const category = fine?.category ?? prefixInfo?.category ?? 'Other';
  const action = fine?.action ?? fallbackLabel(method, routePath, noun);
  const entityType = fine?.entityType ?? prefixInfo?.entityType ?? null;
  const entityId = c.req.param(fine?.idParam ?? 'id') ?? null;

  const db = drizzle(c.env.DB, { schema });

  let companyId: string | null = null;
  if (entityType === 'device' && entityId) {
    const row = await db.select({ companyId: schema.devices.companyId }).from(schema.devices).where(eq(schema.devices.id, entityId)).get();
    companyId = row?.companyId ?? null;
  }

  // Resolved independently of the route's own auth check -- one extra cheap
  // D1 session lookup, only reached here because the request already
  // succeeded. actor can in principle be null (e.g. a session revoked in the
  // instant between the handler's own check and this one) -- log as an
  // unknown/system actor rather than silently dropping the row.
  const actor = await requireUser(c.req.header('Authorization'), c.env);

  await logActivity(db, {
    actorType: actor ? (actor.source === 'break-glass' ? 'break-glass' : 'user') : 'system',
    actorId: actor?.id ?? null,
    actorLabel: actor?.email ?? null,
    category,
    action,
    entityType,
    entityId,
    companyId,
    method,
    path: c.req.path,
  });
}

// ── Retention ────────────────────────────────────────────────────────────

// Deletes activity_log rows older than retentionDays. Throttled via
// host_settings.activity_log_pruned_at (persisted timestamp, not a stateless
// cron-tick bucket) so a missed/delayed cron tick can't silently skip a
// whole day's prune -- mirrors userSessions.lastUsedAt's own throttle shape.
export async function pruneActivityLog(DB: D1Database, now: number, retentionDays = 180): Promise<void> {
  const db = drizzle(DB, { schema });
  const row = await db.select({ prunedAt: schema.hostSettings.activityLogPrunedAt })
    .from(schema.hostSettings).where(eq(schema.hostSettings.id, 1)).get();

  if (row?.prunedAt && now - row.prunedAt < 86400) return;

  const cutoff = now - retentionDays * 86400;
  await db.delete(schema.activityLog).where(lt(schema.activityLog.createdAt, cutoff));
  await db.update(schema.hostSettings).set({ activityLogPrunedAt: now }).where(eq(schema.hostSettings.id, 1));
}
