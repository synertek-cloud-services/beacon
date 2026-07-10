import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import type { Bindings } from '../index';
import * as schema from '../db/schema';

const agentUpdate = new Hono<{ Bindings: Bindings }>();

// GET /v1/agent/version?os=linux&arch=amd64&current=0.1.0
// Returns the latest agent version for the requesting platform.
agentUpdate.get('/version', async (c) => {
  const os = c.req.query('os');
  const arch = c.req.query('arch');
  const currentVersion = c.req.query('current') ?? '0.0.0';

  if (!os || !arch) {
    return c.json({ error: 'os and arch query params required' }, 400);
  }

  const db = drizzle(c.env.DB, { schema });

  const row = await db
    .select()
    .from(schema.agentVersions)
    .where(
      and(
        eq(schema.agentVersions.os, os),
        eq(schema.agentVersions.arch, arch),
        eq(schema.agentVersions.isLatest, true),
      ),
    )
    .get();

  if (!row) {
    return c.json({ error: 'no version published for this platform' }, 404);
  }

  const updateAvailable = row.version !== currentVersion;

  return c.json({
    latest_version: row.version,
    update_available: updateAvailable,
    download_url: updateAvailable ? row.downloadUrl : null,
    signature_hex: updateAvailable ? row.signatureHex : null,
  });
});

// GET /v1/agent/download?os=windows&arch=amd64
// Redirects to the latest signed binary for the given platform. No auth required
// — the binary is universal; the enrollment token is passed separately at install time.
agentUpdate.get('/download', async (c) => {
  const os   = c.req.query('os');
  const arch = c.req.query('arch') ?? 'amd64';

  if (!os) return c.json({ error: 'os query param required' }, 400);

  const db = drizzle(c.env.DB, { schema });

  const row = await db
    .select()
    .from(schema.agentVersions)
    .where(
      and(
        eq(schema.agentVersions.os, os),
        eq(schema.agentVersions.arch, arch),
        eq(schema.agentVersions.isLatest, true),
      ),
    )
    .get();

  if (!row) return c.json({ error: 'no binary published for this platform' }, 404);

  return c.redirect(row.downloadUrl, 302);
});

export default agentUpdate;
