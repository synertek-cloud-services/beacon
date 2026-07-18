-- Preserve Default v1 for cache safety and rollback, while making v2 the
-- refined baseline for new branding fallbacks and hosts still on Default.
UPDATE branding_themes
SET draft_tokens = '{"canvas":"#0c0e16","surface":"#141720","surfaceRaised":"#1c1f2e","surfaceBrand":"#1d1235","border":"#282d40","borderStrong":"#393f59","textPrimary":"#e6e9f5","textMuted":"#a2a8c1","textSubtle":"#7f86a3","textOnPrimary":"#ffffff","primary":"#4169e1","primaryHover":"#4871e0","success":"#2dcfa0","warning":"#f0a840","danger":"#e8566a","info":"#4169e1"}',
    updated_at = unixepoch()
WHERE id = 'default';

INSERT INTO branding_theme_revisions (id, theme_id, revision, tokens, published_at)
SELECT 'default-v2', id, 2, draft_tokens, unixepoch()
FROM branding_themes
WHERE id = 'default';

-- Do not replace a host-selected custom theme. Hosts still using the shipped
-- Default palette advance to the refined revision automatically.
UPDATE branding_settings
SET active_revision_id = 'default-v2', updated_at = unixepoch()
WHERE id = 1 AND active_revision_id = 'default-v1';
