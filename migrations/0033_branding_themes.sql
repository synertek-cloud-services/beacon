-- Host-level, complete color themes. Built-in themes are immutable templates;
-- host-created themes keep an editable draft and immutable published revisions.
CREATE TABLE branding_themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('built_in', 'custom')),
  draft_tokens TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE branding_theme_revisions (
  id TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL REFERENCES branding_themes(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  tokens TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  UNIQUE(theme_id, revision)
);

CREATE TABLE branding_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_revision_id TEXT NOT NULL REFERENCES branding_theme_revisions(id),
  updated_at INTEGER NOT NULL
);

INSERT INTO branding_themes (id, name, source, draft_tokens, created_at, updated_at)
VALUES (
  'default', 'Default', 'built_in',
  '{"canvas":"#0c0e16","surface":"#141720","surfaceRaised":"#1c1f2e","surfaceBrand":"#1a0a2e","border":"#232638","borderStrong":"#2d3148","textPrimary":"#d8daf0","textMuted":"#616480","textSubtle":"#8486a8","textOnPrimary":"#ffffff","primary":"#4e7ef7","primaryHover":"#3b6fd4","success":"#2dcfa0","warning":"#f0a840","danger":"#e8566a","info":"#4e7ef7"}',
  unixepoch(), unixepoch()
);

INSERT INTO branding_theme_revisions (id, theme_id, revision, tokens, published_at)
SELECT 'default-v1', id, 1, draft_tokens, unixepoch() FROM branding_themes WHERE id = 'default';

INSERT INTO branding_settings (id, active_revision_id, updated_at)
VALUES (1, 'default-v1', unixepoch());
