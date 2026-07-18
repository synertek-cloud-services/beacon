-- Built-in themes are immutable templates, not host-published revisions.
-- Custom themes retain their active published revision for cache-safe rollout.
CREATE TABLE branding_settings_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_theme_id TEXT NOT NULL REFERENCES branding_themes(id),
  active_revision_id TEXT REFERENCES branding_theme_revisions(id),
  updated_at INTEGER NOT NULL
);

INSERT INTO branding_settings_new (id, active_theme_id, active_revision_id, updated_at)
SELECT s.id, r.theme_id,
  CASE WHEN t.source = 'custom' THEN s.active_revision_id ELSE NULL END,
  s.updated_at
FROM branding_settings s
JOIN branding_theme_revisions r ON r.id = s.active_revision_id
JOIN branding_themes t ON t.id = r.theme_id;

DROP TABLE branding_settings;
ALTER TABLE branding_settings_new RENAME TO branding_settings;

DELETE FROM branding_theme_revisions
WHERE theme_id IN (SELECT id FROM branding_themes WHERE source = 'built_in');
