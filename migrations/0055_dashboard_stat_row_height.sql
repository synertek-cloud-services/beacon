-- Follow-up to 0054: with gridstack's between-widget margin corrected to 7
-- (see DashboardPage.vue -- 14 was accidentally doubling the real gap to
-- 28px), device_summary's h needed resolving for again. h=8 is the closest
-- integer fit that doesn't compress the stat row below its real measured
-- 102px natural height (h=7 undershoots to 98px and clips) while landing
-- closest to the widget's 14px left/right padding once centered (h=8's
-- total visible top/bottom gap works out to ~22px; h=9's to ~32px).
UPDATE dashboard_widgets
SET grid_y = CASE id
  WHEN 'default-summary' THEN 0
  WHEN 'default-recent-alerts' THEN 8
  WHEN 'default-online' THEN 22
  WHEN 'default-os' THEN 22
  WHEN 'default-class' THEN 22
  WHEN 'default-offline' THEN 32
  WHEN 'default-antivirus' THEN 32
  WHEN 'default-priority' THEN 32
  ELSE grid_y
END,
grid_h = CASE id
  WHEN 'default-summary' THEN 8
  ELSE grid_h
END,
updated_at = unixepoch()
WHERE dashboard_id = 'default-dashboard';
