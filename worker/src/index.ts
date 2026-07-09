import { Hono } from 'hono';
import enroll from './routes/enroll';
import checkin from './routes/checkin';

export type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.route('/v1/enroll', enroll);
app.route('/v1/check-in', checkin);

app.get('/health', (c) => c.json({ ok: true }));

export default app;
