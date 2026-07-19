-- Follow-up to 0040: donut widgets do not need five 44px grid rows. Tighten
-- only the seeded dashboard; host-created layouts remain exactly as configured.
UPDATE dashboard_widgets
SET grid_y = CASE id
  WHEN 'default-summary' THEN 0
  WHEN 'default-recent-alerts' THEN 3
  WHEN 'default-online' THEN 9
  WHEN 'default-os' THEN 9
  WHEN 'default-class' THEN 9
  WHEN 'default-offline' THEN 13
  WHEN 'default-antivirus' THEN 13
  WHEN 'default-priority' THEN 13
  ELSE grid_y
END,
grid_h = CASE id
  WHEN 'default-summary' THEN 3
  WHEN 'default-recent-alerts' THEN 6
  WHEN 'default-online' THEN 4
  WHEN 'default-os' THEN 4
  WHEN 'default-class' THEN 4
  WHEN 'default-offline' THEN 4
  WHEN 'default-antivirus' THEN 4
  WHEN 'default-priority' THEN 4
  ELSE grid_h
END,
updated_at = unixepoch()
WHERE dashboard_id = 'default-dashboard';
