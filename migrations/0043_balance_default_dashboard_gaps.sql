-- The dashboard grid now uses 10px tracks and 10px row gaps. Rebalance the
-- seeded widget spans so this improves visual separation without adding height.
UPDATE dashboard_widgets
SET grid_y = CASE id
  WHEN 'default-summary' THEN 0
  WHEN 'default-recent-alerts' THEN 7
  WHEN 'default-online' THEN 22
  WHEN 'default-os' THEN 22
  WHEN 'default-class' THEN 22
  WHEN 'default-offline' THEN 30
  WHEN 'default-antivirus' THEN 30
  WHEN 'default-priority' THEN 30
  ELSE grid_y
END,
grid_h = CASE id
  WHEN 'default-summary' THEN 7
  WHEN 'default-recent-alerts' THEN 15
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
