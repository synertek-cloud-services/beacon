import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser, type Role } from '../../lib/auth';

const adminActivityLog = new Hono<{ Bindings: Bindings }>();

function auth(c: any, minRole: Role = 'readonly') {
  return requireUser(c.req.header('Authorization'), c.env, minRole);
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

// GET /v1/admin/activity-log — server-side filtered + paginated. The first
// genuinely unbounded, account-wide-forever table in this codebase (every
// other "unbounded" list page in this app is actually bounded-by-cap
// client-side pagination over a server LIMIT) -- plain LIMIT/OFFSET +
// matching COUNT(*), not keyset/cursor pagination, since this project's own
// self-hosted scale doesn't need keyset's complexity and LIMIT/OFFSET lets
// the dashboard reuse the existing numbered .pagination bar's UI/interaction
// unchanged.
adminActivityLog.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const q = c.req.query();

  const conditions: SQL[] = [];
  if (q.company_id)   conditions.push(eq(schema.activityLog.companyId, q.company_id));
  if (q.actor_id)    conditions.push(eq(schema.activityLog.actorId, q.actor_id));
  if (q.category)    conditions.push(eq(schema.activityLog.category, q.category));
  if (q.entity_type) conditions.push(eq(schema.activityLog.entityType, q.entity_type));
  if (q.entity_id)   conditions.push(eq(schema.activityLog.entityId, q.entity_id));
  if (q.from)        conditions.push(gte(schema.activityLog.createdAt, Number(q.from)));
  if (q.to)          conditions.push(lte(schema.activityLog.createdAt, Number(q.to)));

  const where = conditions.length ? and(...conditions) : undefined;

  const limit  = Math.min(MAX_LIMIT, Math.max(1, Number(q.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(q.offset) || 0);

  const [rows, totalRow] = await Promise.all([
    db.select().from(schema.activityLog).where(where).orderBy(desc(schema.activityLog.createdAt)).limit(limit).offset(offset).all(),
    db.select({ count: sql<number>`count(*)` }).from(schema.activityLog).where(where).get(),
  ]);

  return c.json({ rows, total: totalRow?.count ?? 0 });
});

export default adminActivityLog;
