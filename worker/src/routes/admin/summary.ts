import { Hono } from 'hono';
import type { Bindings } from '../../index';
import { requireUser } from '../../lib/auth';
import { buildDashboardData } from '../../lib/dashboardData';

const adminSummary = new Hono<{ Bindings: Bindings }>();

adminSummary.get('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  return c.json((await buildDashboardData(c.env.DB)).summary);
});

export default adminSummary;
