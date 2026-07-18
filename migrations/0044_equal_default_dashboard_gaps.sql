-- Match vertical and horizontal dashboard spacing at 14px while keeping the
-- seeded cards near their prior physical height with 8px grid tracks.
UPDATE dashboard_widgets
SET grid_y = CASE id
  WHEN 'default-summary' THEN 0
  WHEN 'default-recent-alerts' THEN 7
  WHEN 'default-online' THEN 21
  WHEN 'default-os' THEN 21
  WHEN 'default-class' THEN 21
  WHEN 'default-offline' THEN 29
  WHEN 'default-antivirus' THEN 29
  WHEN 'default-priority' THEN 29
  ELSE grid_y
END,
grid_h = CASE id
  WHEN 'default-summary' THEN 7
  WHEN 'default-recent-alerts' THEN 14
  WHEN 'default-online' THEN 8
  WHEN 'default-os' THEN 8
  WHEN 'default-class' THEN 8
  WHEN 'default-offline' THEN 8
  WHEN 'default-antivirus' THEN 8
  WHEN 'default-priority' THEN 8
  ELSE grid_h
END,
updated_at = unixepoch()
WHERE dashboard_id = 'default-dashboard';
