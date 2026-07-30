import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, isNotNull, and } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser, type Role } from '../../lib/auth';

const adminPatches = new Hono<{ Bindings: Bindings }>();

function auth(c: any, minRole: Role = 'readonly') {
  return requireUser(c.req.header('Authorization'), c.env, minRole);
}

interface PatchItem {
  update_id?: string;
  title: string;
  kb_article_ids: string[];
  severity: string;
  categories: string[];
  size_bytes?: number;
  is_downloaded: boolean;
}

interface FleetPatch {
  updateId: string;
  title: string;
  kbArticleIds: string[];
  severity: string;
  categories: string[];
  deviceIds: string[];
  status: 'pending' | 'approved' | 'ignored';
}

// GET /v1/admin/patches — every distinct patch currently pending across the
// fleet, grouped by update_id, merged with its fleet-wide approval status
// (default 'pending' when no patch_approvals row exists). One query per
// approved device for its latest audit -- fine at this scale, same reasoning
// as the custom-fields rename guard's full-table scan (self-hosted, tens to
// hundreds of devices, not thousands).
adminPatches.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const devices = await db.select({ id: schema.devices.id, hostname: schema.devices.hostname })
    .from(schema.devices)
    .where(eq(schema.devices.status, 'approved'))
    .all();

  const byUpdateId = new Map<string, FleetPatch>();
  // Patches with no update_id (pre-upgrade agents) can't be tied to a
  // fleet-wide approval decision -- surfaced separately so the UI can show
  // "rescan needed" instead of a broken approve action.
  let needsRescan = 0;

  for (const device of devices) {
    const audit = await db.select({ patches: schema.deviceAudits.patches })
      .from(schema.deviceAudits)
      .where(and(eq(schema.deviceAudits.deviceId, device.id), isNotNull(schema.deviceAudits.patches)))
      .orderBy(desc(schema.deviceAudits.createdAt))
      .limit(1)
      .get();
    if (!audit?.patches) continue;

    let items: PatchItem[];
    try {
      items = JSON.parse(audit.patches);
    } catch {
      continue;
    }

    for (const item of items) {
      if (!item.update_id) {
        needsRescan++;
        continue;
      }
      let entry = byUpdateId.get(item.update_id);
      if (!entry) {
        entry = {
          updateId: item.update_id,
          title: item.title,
          kbArticleIds: item.kb_article_ids ?? [],
          severity: item.severity,
          categories: item.categories ?? [],
          deviceIds: [],
          status: 'pending',
        };
        byUpdateId.set(item.update_id, entry);
      }
      entry.deviceIds.push(device.id);
    }
  }

  if (byUpdateId.size > 0) {
    const approvals = await db.select().from(schema.patchApprovals).all();
    for (const a of approvals) {
      const entry = byUpdateId.get(a.updateId);
      if (entry) entry.status = a.status as 'approved' | 'ignored';
    }
  }

  return c.json({
    patches: [...byUpdateId.values()],
    needsRescan, // count of pending patch entries with no update_id yet
  });
});

// PATCH /v1/admin/patches/:updateId — set (or clear) this update's fleet-wide
// approval status. 'pending' deletes the row rather than storing a third
// status value, keeping "no row = pending" the single source of truth.
adminPatches.patch('/:updateId', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const updateId = c.req.param('updateId');
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    status: 'approved' | 'ignored' | 'pending';
    title?: string;
    kb_article_ids?: string[];
    severity?: string;
  }>();

  if (body.status === 'pending') {
    await db.delete(schema.patchApprovals).where(eq(schema.patchApprovals.updateId, updateId));
    return c.json({ ok: true });
  }

  if (body.status !== 'approved' && body.status !== 'ignored') {
    return c.json({ error: 'status must be approved, ignored, or pending' }, 400);
  }

  const existing = await db.select({ updateId: schema.patchApprovals.updateId })
    .from(schema.patchApprovals)
    .where(eq(schema.patchApprovals.updateId, updateId))
    .get();

  if (existing) {
    await db.update(schema.patchApprovals)
      .set({ status: body.status, updatedAt: now })
      .where(eq(schema.patchApprovals.updateId, updateId));
  } else {
    await db.insert(schema.patchApprovals).values({
      updateId,
      status: body.status,
      title: body.title ?? '',
      kbArticleIds: JSON.stringify(body.kb_article_ids ?? []),
      severity: body.severity ?? null,
      updatedAt: now,
    });
  }

  return c.json({ ok: true });
});

export default adminPatches;
