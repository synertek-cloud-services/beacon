import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { Bindings } from '../index';
import * as schema from '../db/schema';
import { requireUser } from '../lib/auth';

export const THEME_KEYS = [
  'canvas', 'surface', 'surfaceRaised', 'surfaceBrand', 'border', 'borderStrong',
  'textPrimary', 'textMuted', 'textSubtle', 'textOnPrimary', 'primary',
  'primaryHover', 'success', 'warning', 'danger', 'info',
] as const;
export type ThemeKey = typeof THEME_KEYS[number];
export type ThemeTokens = Record<ThemeKey, string>;

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_PUBLISHED_REVISIONS = 5;

function parseTokens(value: unknown): ThemeTokens | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== THEME_KEYS.length || !THEME_KEYS.every(k => COLOR_RE.test(String(record[k] ?? '')))) return null;
  return Object.fromEntries(THEME_KEYS.map(k => [k, String(record[k]).toLowerCase()])) as ThemeTokens;
}

function noStore(c: any) { c.header('Cache-Control', 'no-store'); }
function immutable(c: any) { c.header('Cache-Control', 'public, max-age=31536000, immutable'); }
async function admin(c: any) { return requireUser(c.req.header('Authorization'), c.env, 'admin'); }

const branding = new Hono<{ Bindings: Bindings }>();

// Tiny pointer: always revalidated, so a new active revision is discovered on
// the next load while the immutable palette itself can be cached long-term.
branding.get('/active', async (c) => {
  noStore(c);
  const row = await c.env.DB.prepare(`
    SELECT r.id AS revision_id, r.theme_id, r.revision, r.published_at, t.name
    FROM branding_settings s
    JOIN branding_theme_revisions r ON r.id = s.active_revision_id
    JOIN branding_themes t ON t.id = r.theme_id
    WHERE s.id = 1
  `).first<{ revision_id: string; theme_id: string; revision: number; published_at: number; name: string }>();
  if (!row) return c.json({ error: 'branding is not configured' }, 404);
  return c.json({ revisionId: row.revision_id, themeId: row.theme_id, name: row.name, revision: row.revision, publishedAt: row.published_at });
});

branding.get('/revisions/:id', async (c) => {
  const row = await drizzle(c.env.DB, { schema }).select({ id: schema.brandingThemeRevisions.id, tokens: schema.brandingThemeRevisions.tokens })
    .from(schema.brandingThemeRevisions).where(eq(schema.brandingThemeRevisions.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: 'theme revision not found' }, 404);
  const tokens = parseTokens(JSON.parse(row.tokens));
  if (!tokens) return c.json({ error: 'invalid theme revision' }, 500);
  immutable(c);
  return c.json({ id: row.id, tokens });
});

branding.get('/admin/themes', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const themes = await db.select().from(schema.brandingThemes).all();
  const active = await db.select({ activeRevisionId: schema.brandingSettings.activeRevisionId }).from(schema.brandingSettings).where(eq(schema.brandingSettings.id, 1)).get();
  const revisions = await db.select().from(schema.brandingThemeRevisions).orderBy(desc(schema.brandingThemeRevisions.publishedAt)).all();
  return c.json(themes.map(theme => ({
    id: theme.id, name: theme.name, source: theme.source,
    draftTokens: parseTokens(JSON.parse(theme.draftTokens)),
    revisions: revisions.filter(r => r.themeId === theme.id).map(r => ({ id: r.id, revision: r.revision, publishedAt: r.publishedAt })),
    active: revisions.some(r => r.id === active?.activeRevisionId && r.themeId === theme.id),
  })));
});

branding.post('/admin/themes', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ name?: string; tokens?: unknown }>();
  const name = body.name?.trim(); const tokens = parseTokens(body.tokens);
  if (!name) return c.json({ error: 'name is required' }, 400);
  if (!tokens) return c.json({ error: 'a complete valid palette is required' }, 400);
  const id = crypto.randomUUID(), now = Math.floor(Date.now() / 1000);
  await drizzle(c.env.DB, { schema }).insert(schema.brandingThemes).values({ id, name, source: 'custom', draftTokens: JSON.stringify(tokens), createdAt: now, updatedAt: now });
  return c.json({ id }, 201);
});

branding.patch('/admin/themes/:id', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ name?: string; tokens?: unknown }>();
  const db = drizzle(c.env.DB, { schema });
  const theme = await db.select().from(schema.brandingThemes).where(eq(schema.brandingThemes.id, c.req.param('id'))).get();
  if (!theme) return c.json({ error: 'theme not found' }, 404);
  if (theme.source === 'built_in') return c.json({ error: 'built-in themes cannot be edited' }, 403);
  const updates: Partial<typeof schema.brandingThemes.$inferInsert> = { updatedAt: Math.floor(Date.now() / 1000) };
  if (body.name !== undefined) { if (!body.name.trim()) return c.json({ error: 'name is required' }, 400); updates.name = body.name.trim(); }
  if (body.tokens !== undefined) { const tokens = parseTokens(body.tokens); if (!tokens) return c.json({ error: 'a complete valid palette is required' }, 400); updates.draftTokens = JSON.stringify(tokens); }
  await db.update(schema.brandingThemes).set(updates).where(eq(schema.brandingThemes.id, theme.id));
  return c.json({ ok: true });
});

branding.post('/admin/themes/:id/publish', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const theme = await db.select().from(schema.brandingThemes).where(eq(schema.brandingThemes.id, c.req.param('id'))).get();
  if (!theme) return c.json({ error: 'theme not found' }, 404);
  if (theme.source === 'built_in') return c.json({ error: 'built-in themes are already published' }, 400);
  const tokens = parseTokens(JSON.parse(theme.draftTokens)); if (!tokens) return c.json({ error: 'invalid draft palette' }, 400);
  const last = await db.select({ revision: schema.brandingThemeRevisions.revision }).from(schema.brandingThemeRevisions)
    .where(eq(schema.brandingThemeRevisions.themeId, theme.id)).orderBy(desc(schema.brandingThemeRevisions.revision)).get();
  const revision = (last?.revision ?? 0) + 1, id = `${theme.id}-v${revision}`, now = Math.floor(Date.now() / 1000);
  await db.insert(schema.brandingThemeRevisions).values({ id, themeId: theme.id, revision, tokens: JSON.stringify(tokens), publishedAt: now });

  // Keep a compact rollback history. The currently active revision is always
  // protected, even if it is older than the four most-recent inactive ones.
  const active = await db.select({ activeRevisionId: schema.brandingSettings.activeRevisionId })
    .from(schema.brandingSettings).where(eq(schema.brandingSettings.id, 1)).get();
  const revisions = await db.select({ id: schema.brandingThemeRevisions.id, revision: schema.brandingThemeRevisions.revision })
    .from(schema.brandingThemeRevisions).where(eq(schema.brandingThemeRevisions.themeId, theme.id))
    .orderBy(desc(schema.brandingThemeRevisions.revision)).all();
  const retained = [...revisions];
  let pruned = 0;
  while (retained.length > MAX_PUBLISHED_REVISIONS) {
    const oldestInactive = [...retained].reverse().find(r => r.id !== active?.activeRevisionId);
    if (!oldestInactive) break;
    await db.delete(schema.brandingThemeRevisions).where(eq(schema.brandingThemeRevisions.id, oldestInactive.id));
    retained.splice(retained.findIndex(r => r.id === oldestInactive.id), 1);
    pruned++;
  }
  return c.json({ id, revision, publishedAt: now, pruned }, 201);
});

branding.post('/admin/revisions/:id/activate', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const revision = await db.select({ id: schema.brandingThemeRevisions.id }).from(schema.brandingThemeRevisions).where(eq(schema.brandingThemeRevisions.id, c.req.param('id'))).get();
  if (!revision) return c.json({ error: 'theme revision not found' }, 404);
  await db.update(schema.brandingSettings).set({ activeRevisionId: revision.id, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(schema.brandingSettings.id, 1));
  return c.json({ ok: true });
});

branding.delete('/admin/themes/:id', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const theme = await db.select().from(schema.brandingThemes).where(eq(schema.brandingThemes.id, c.req.param('id'))).get();
  if (!theme) return c.json({ error: 'theme not found' }, 404);
  if (theme.source === 'built_in') return c.json({ error: 'built-in themes cannot be deleted' }, 403);
  const active = await db.select({ id: schema.brandingThemeRevisions.id }).from(schema.brandingSettings)
    .innerJoin(schema.brandingThemeRevisions, eq(schema.brandingSettings.activeRevisionId, schema.brandingThemeRevisions.id)).where(and(eq(schema.brandingSettings.id, 1), eq(schema.brandingThemeRevisions.themeId, theme.id))).get();
  if (active) return c.json({ error: 'activate another theme before deleting this one' }, 409);
  await db.delete(schema.brandingThemes).where(eq(schema.brandingThemes.id, theme.id));
  return c.json({ ok: true });
});

export default branding;
