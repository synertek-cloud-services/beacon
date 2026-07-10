import { Hono } from 'hono';
import enroll from './routes/enroll';
import checkin from './routes/checkin';
import adminCommands from './routes/admin/commands';

export type Bindings = {
  DB: D1Database;
  ADMIN_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.route('/v1/enroll', enroll);
app.route('/v1/check-in', checkin);
app.route('/v1/admin/commands', adminCommands);

app.get('/health', (c) => c.json({ ok: true }));

export default app;
