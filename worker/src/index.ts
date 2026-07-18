import { Hono } from 'hono';
import { cors } from 'hono/cors';
import enroll from './routes/enroll';
import checkin from './routes/checkin';
import auditRoute from './routes/audit';
import sessions from './routes/sessions';
import agentUpdate from './routes/agent-update';
import adminSummary from './routes/admin/summary';
import adminTenants from './routes/admin/tenants';
import adminDevices from './routes/admin/devices';
import adminCommands from './routes/admin/commands';
import adminPolicies from './routes/admin/policies';
import adminAlerts from './routes/admin/alerts';
import adminWebhooks from './routes/admin/webhooks';
import adminAgentVersions from './routes/admin/agent-versions';
import adminComponents from './routes/admin/components';
import adminJobs, { dispatchDueScheduledJobs, cancelExpiredScheduledJobs } from './routes/admin/jobs';
import authRoute from './routes/auth';
import authMicrosoft from './routes/auth-microsoft';
import adminUsers from './routes/admin/users';
import adminSso from './routes/admin/sso';
import adminCustomFields from './routes/admin/custom-fields';
import adminGroups from './routes/admin/groups';
import adminDashboards from './routes/admin/dashboards';
import branding from './routes/branding';
import { evaluateOfflineAlerts } from './lib/alerts';

export { SessionRelay } from './durable-objects/session-relay';

export type Bindings = {
  DB: D1Database;
  ADMIN_SECRET: string;
  SESSION: DurableObjectNamespace;
  // Production dashboard origin, e.g. "https://rmm.example.com"
  ALLOWED_ORIGIN?: string;
  // Cloudflare Pages preview URL suffix, e.g. ".my-dashboard-1a2.pages.dev"
  PAGES_PREVIEW_SUFFIX?: string;
  // AES-GCM key (hex) for encrypting SSO provider client secrets at rest
  CONFIG_ENCRYPTION_KEY: string;
  // This worker's own public origin, e.g. "https://rmm-api.example.com" —
  // used to build absolute agent/client WebSocket URLs in sessions.ts.
  // Deliberately a configured value, not derived from the incoming request's
  // own URL: a [[routes]] custom-domain block in wrangler.toml can make
  // c.req.url reflect the production route even under `wrangler dev`,
  // which previously sent local-dev sessions to the real production worker.
  WORKER_URL: string;
  // Stores host-uploaded branding logos
  LOGOS: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

const corsMiddleware = (c: any, next: any) => cors({
  origin: (origin) => {
    if (!origin) return '';
    if (
      origin === c.env.ALLOWED_ORIGIN ||
      origin === 'http://localhost:5173' ||
      (c.env.PAGES_PREVIEW_SUFFIX && origin.endsWith(c.env.PAGES_PREVIEW_SUFFIX))
    ) return origin;
    return '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
})(c, next);

app.use('/v1/admin/*', corsMiddleware);
app.use('/v1/auth/*', corsMiddleware);
app.use('/v1/sessions', corsMiddleware);
app.use('/v1/sessions/*', corsMiddleware);
app.use('/v1/branding/*', corsMiddleware);

app.route('/v1/enroll', enroll);
app.route('/v1/check-in', checkin);
app.route('/v1/audit', auditRoute);
app.route('/v1/sessions', sessions);
app.route('/v1/agent', agentUpdate);
app.route('/v1/branding', branding);
app.route('/v1/admin/summary', adminSummary);
app.route('/v1/admin/tenants', adminTenants);
app.route('/v1/admin/devices', adminDevices);
app.route('/v1/admin/commands', adminCommands);
app.route('/v1/admin/policies', adminPolicies);
app.route('/v1/admin/alerts', adminAlerts);
app.route('/v1/admin/webhooks', adminWebhooks);
app.route('/v1/admin/agent/versions', adminAgentVersions);
app.route('/v1/admin/components', adminComponents);
app.route('/v1/admin/jobs', adminJobs);
app.route('/v1/admin/users', adminUsers);
app.route('/v1/admin/sso', adminSso);
app.route('/v1/admin/custom-fields', adminCustomFields);
app.route('/v1/admin/groups', adminGroups);
app.route('/v1/admin/dashboards', adminDashboards);
app.route('/v1/auth', authRoute);
app.route('/v1/auth/microsoft', authMicrosoft);

app.get('/health', (c) => c.json({ ok: true }));

export default {
  fetch(req: Request, env: Bindings) {
    return app.fetch(req, env);
  },
  async scheduled(_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) {
    const now = Math.floor(Date.now() / 1000);
    await evaluateOfflineAlerts(env.DB, now);
    await dispatchDueScheduledJobs(env.DB, now);
    await cancelExpiredScheduledJobs(env.DB, now);
  },
};
