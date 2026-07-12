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
import adminAlertDefs from './routes/admin/alert-definitions';
import adminAlerts from './routes/admin/alerts';
import adminWebhooks from './routes/admin/webhooks';
import adminAgentVersions from './routes/admin/agent-versions';
import adminComponents from './routes/admin/components';
import adminJobs from './routes/admin/jobs';
import { evaluateOfflineAlerts } from './lib/alerts';

export { SessionRelay } from './durable-objects/session-relay';

export type Bindings = {
  DB: D1Database;
  ADMIN_SECRET: string;
  SESSION: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/v1/admin/*', cors({
  origin: (origin) => {
    if (!origin) return '';
    if (
      origin === 'https://rmm.cloud.synertekcs.com' ||
      origin === 'http://localhost:5173' ||
      origin.endsWith('.beacon-dashboard-6f4.pages.dev')
    ) return origin;
    return '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

app.route('/v1/enroll', enroll);
app.route('/v1/check-in', checkin);
app.route('/v1/audit', auditRoute);
app.route('/v1/sessions', sessions);
app.route('/v1/agent', agentUpdate);
app.route('/v1/admin/summary', adminSummary);
app.route('/v1/admin/tenants', adminTenants);
app.route('/v1/admin/devices', adminDevices);
app.route('/v1/admin/commands', adminCommands);
app.route('/v1/admin/alert-definitions', adminAlertDefs);
app.route('/v1/admin/alerts', adminAlerts);
app.route('/v1/admin/webhooks', adminWebhooks);
app.route('/v1/admin/agent/versions', adminAgentVersions);
app.route('/v1/admin/components', adminComponents);
app.route('/v1/admin/jobs', adminJobs);

app.get('/health', (c) => c.json({ ok: true }));

export default {
  fetch(req: Request, env: Bindings) {
    return app.fetch(req, env);
  },
  async scheduled(_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) {
    const now = Math.floor(Date.now() / 1000);
    await evaluateOfflineAlerts(env.DB, now);
  },
};
