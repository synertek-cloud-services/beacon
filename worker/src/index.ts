import { Hono } from 'hono';
import enroll from './routes/enroll';
import checkin from './routes/checkin';
import sessions from './routes/sessions';
import adminCommands from './routes/admin/commands';
import adminAlertDefs from './routes/admin/alert-definitions';
import adminWebhooks from './routes/admin/webhooks';
import { evaluateOfflineAlerts } from './lib/alerts';

export { SessionRelay } from './durable-objects/session-relay';

export type Bindings = {
  DB: D1Database;
  ADMIN_SECRET: string;
  SESSION: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.route('/v1/enroll', enroll);
app.route('/v1/check-in', checkin);
app.route('/v1/sessions', sessions);
app.route('/v1/admin/commands', adminCommands);
app.route('/v1/admin/alert-definitions', adminAlertDefs);
app.route('/v1/admin/webhooks', adminWebhooks);

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
