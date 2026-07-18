-- The initial dashboard layout needs enough row height for real chart/table
-- content. Keep this separate from 0039 because that migration may already be
-- applied to a host's local database.
UPDATE dashboard_widgets
SET grid_y = CASE id
  WHEN 'default-summary' THEN 0
  WHEN 'default-recent-alerts' THEN 3
  WHEN 'default-online' THEN 9
  WHEN 'default-os' THEN 9
  WHEN 'default-class' THEN 9
  WHEN 'default-offline' THEN 14
  WHEN 'default-antivirus' THEN 14
  WHEN 'default-priority' THEN 14
  ELSE grid_y
END,
grid_h = CASE id
  WHEN 'default-summary' THEN 3
  WHEN 'default-recent-alerts' THEN 6
  WHEN 'default-online' THEN 5
  WHEN 'default-os' THEN 5
  WHEN 'default-class' THEN 5
  WHEN 'default-offline' THEN 5
  WHEN 'default-antivirus' THEN 5
  WHEN 'default-priority' THEN 5
  ELSE grid_h
END,
updated_at = unixepoch()
WHERE dashboard_id = 'default-dashboard';
