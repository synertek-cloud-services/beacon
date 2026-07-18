-- Keep the short, consistent preset naming without changing Sentry's
-- existing immutable revision ID or any active-theme reference.
UPDATE branding_themes
SET name = 'Sentry-i', updated_at = unixepoch()
WHERE id = 'sentry-inspired';

-- Complete built-in dark palettes adapted from Cobalt2 and SyntaxFM.
-- They are templates only and do not imply endorsement by either project.
INSERT INTO branding_themes (id, name, source, draft_tokens, created_at, updated_at)
VALUES
(
  'cobalt2-i', 'Cobalt2-i', 'built_in',
  '{"canvas":"#122738","surface":"#15232d","surfaceRaised":"#193549","surfaceBrand":"#0d3a58","border":"#3b5364","borderStrong":"#406179","textPrimary":"#ffffff","textMuted":"#aaaaaa","textSubtle":"#7790a0","textOnPrimary":"#000000","primary":"#0088ff","primaryHover":"#ff9d00","success":"#3ad900","warning":"#ffc600","danger":"#ff628c","info":"#9effff"}',
  unixepoch(), unixepoch()
),
(
  'syntaxfm-i', 'SyntaxFM-i', 'built_in',
  '{"canvas":"#000000","surface":"#121212","surfaceRaised":"#1d1d1d","surfaceBrand":"#2a251b","border":"#343434","borderStrong":"#4a4a4a","textPrimary":"#f5f5f5","textMuted":"#b4b4b4","textSubtle":"#898989","textOnPrimary":"#1d1d1d","primary":"#fabf46","primaryHover":"#ffd071","success":"#4fca7a","warning":"#fabf46","danger":"#f06a6a","info":"#55b7d9"}',
  unixepoch(), unixepoch()
),
(
  'slate', 'Slate', 'built_in',
  '{"canvas":"#111418","surface":"#181c22","surfaceRaised":"#22272e","surfaceBrand":"#1c2630","border":"#303842","borderStrong":"#424d59","textPrimary":"#e6edf3","textMuted":"#9aa7b4","textSubtle":"#74808c","textOnPrimary":"#ffffff","primary":"#4f8cc9","primaryHover":"#6aa5df","success":"#4caf78","warning":"#d6a343","danger":"#d96570","info":"#4f8cc9"}',
  unixepoch(), unixepoch()
);

INSERT INTO branding_theme_revisions (id, theme_id, revision, tokens, published_at)
SELECT 'cobalt2-i-v1', id, 1, draft_tokens, unixepoch()
FROM branding_themes
WHERE id = 'cobalt2-i';

INSERT INTO branding_theme_revisions (id, theme_id, revision, tokens, published_at)
SELECT 'syntaxfm-i-v1', id, 1, draft_tokens, unixepoch()
FROM branding_themes
WHERE id = 'syntaxfm-i';

INSERT INTO branding_theme_revisions (id, theme_id, revision, tokens, published_at)
SELECT 'slate-v1', id, 1, draft_tokens, unixepoch()
FROM branding_themes
WHERE id = 'slate';
