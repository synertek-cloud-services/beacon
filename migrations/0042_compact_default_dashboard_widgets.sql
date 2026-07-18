-- Dashboard grid rows are now fine-grained (8px with a 4px row gap), so the
-- seeded layout can fit the real summary, table, and donut content precisely.
UPDATE dashboard_widgets
SET grid_y = CASE id
  WHEN 'default-summary' THEN 0
  WHEN 'default-recent-alerts' THEN 11
  WHEN 'default-online' THEN 35
  WHEN 'default-os' THEN 35
  WHEN 'default-class' THEN 35
  WHEN 'default-offline' THEN 48
  WHEN 'default-antivirus' THEN 48
  WHEN 'default-priority' THEN 48
  ELSE grid_y
END,
grid_h = CASE id
  WHEN 'default-summary' THEN 11
  WHEN 'default-recent-alerts' THEN 24
  WHEN 'default-online' THEN 13
  WHEN 'default-os' THEN 13
  WHEN 'default-class' THEN 13
  WHEN 'default-offline' THEN 13
  WHEN 'default-antivirus' THEN 13
  WHEN 'default-priority' THEN 13
  ELSE grid_h
END,
updated_at = unixepoch()
WHERE dashboard_id = 'default-dashboard';
