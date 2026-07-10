import { Hono } from 'hono';
import enroll from './routes/enroll';
import checkin from './routes/checkin';
import adminCommands from './routes/admin/commands';
import adminAlertDefs from './routes/admin/alert-definitions';
import adminWebhooks from './routes/admin/webhooks';
import { evaluateOfflineAlerts } from './lib/alerts';

export type Bindings = {
  DB: D1Database;
  ADMIN_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.route('/v1/enroll', enroll);
app.route('/v1/check-in', checkin);
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
