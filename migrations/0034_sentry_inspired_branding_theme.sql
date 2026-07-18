-- A complete, built-in dark theme inspired by Sentry's documented widget palette.
-- It is a template only and does not imply Sentry endorsement.
INSERT INTO branding_themes (id, name, source, draft_tokens, created_at, updated_at)
VALUES (
  'sentry-inspired', 'Sentry-inspired', 'built_in',
  '{"canvas":"#1f1a24","surface":"#29232f","surfaceRaised":"#352f3b","surfaceBrand":"#2b2233","border":"#49434e","borderStrong":"#625a68","textPrimary":"#ebe6ef","textMuted":"#a89faa","textSubtle":"#817789","textOnPrimary":"#ffffff","primary":"#584ac0","primaryHover":"#6c5fc7","success":"#2da98c","warning":"#e3a63b","danger":"#f55459","info":"#6c5fc7"}',
  unixepoch(), unixepoch()
);

INSERT INTO branding_theme_revisions (id, theme_id, revision, tokens, published_at)
SELECT 'sentry-inspired-v1', id, 1, draft_tokens, unixepoch()
FROM branding_themes
WHERE id = 'sentry-inspired';
