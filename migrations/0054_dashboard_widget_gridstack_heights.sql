-- The seeded default dashboard's widget heights were hand-tuned four times
-- (0040-0044) for the pre-gridstack CSS Grid system, whose h*8px+gap math
-- gave a genuinely taller per-widget height than gridstack's own h*cellHeight
-- model produces for the same h value (see DashboardPage.vue's gridOptions
-- comment). Confirmed via live measurement, not guessed, that the old h=7/8
-- values now clip real content under gridstack: the stat row's text touches
-- its own bottom border, and donut chart titles crowd the chart above them.
UPDATE dashboard_widgets
SET grid_y = CASE id
  WHEN 'default-summary' THEN 0
  WHEN 'default-recent-alerts' THEN 9
  WHEN 'default-online' THEN 23
  WHEN 'default-os' THEN 23
  WHEN 'default-class' THEN 23
  WHEN 'default-offline' THEN 33
  WHEN 'default-antivirus' THEN 33
  WHEN 'default-priority' THEN 33
  ELSE grid_y
END,
grid_h = CASE id
  WHEN 'default-summary' THEN 9
  WHEN 'default-recent-alerts' THEN 14
  WHEN 'default-online' THEN 10
  WHEN 'default-os' THEN 10
  WHEN 'default-class' THEN 10
  WHEN 'default-offline' THEN 10
  WHEN 'default-antivirus' THEN 10
  WHEN 'default-priority' THEN 10
  ELSE grid_h
END,
updated_at = unixepoch()
WHERE dashboard_id = 'default-dashboard';
