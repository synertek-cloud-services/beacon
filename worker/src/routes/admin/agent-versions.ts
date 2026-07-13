import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';

const adminAgentVersions = new Hono<{ Bindings: Bindings }>();

// POST /v1/admin/agent/versions
// Registers a new agent binary version. Marks it as latest for its platform.
// Body: { version, os, arch, download_url, signature_hex }
adminAgentVersions.post('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'technician'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json<{
    version: string;
    os: string;
    arch: string;
    download_url: string;
    signature_hex: string;
  }>();

  if (!body.version || !body.os || !body.arch || !body.download_url || !body.signature_hex) {
    return c.json({ error: 'version, os, arch, download_url, signature_hex required' }, 400);
  }

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  // Clear the current latest flag for this platform before setting the new one.
  await db
    .update(schema.agentVersions)
    .set({ isLatest: false })
    .where(
      and(
        eq(schema.agentVersions.os, body.os),
        eq(schema.agentVersions.arch, body.arch),
        eq(schema.agentVersions.isLatest, true),
      ),
    );

  const id = crypto.randomUUID();
  await db.insert(schema.agentVersions).values({
    id,
    version: body.version,
    os: body.os,
    arch: body.arch,
    downloadUrl: body.download_url,
    signatureHex: body.signature_hex,
    publishedAt: now,
    isLatest: true,
  });

  return c.json({ id, version: body.version, os: body.os, arch: body.arch });
});

// GET /v1/admin/agent/versions — list all registered versions
adminAgentVersions.get('/', async (c) => {
  if (!(await requireUser(c.req.header('Authorization'), c.env, 'readonly'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.agentVersions).all();
  return c.json(rows);
});

export default adminAgentVersions;
