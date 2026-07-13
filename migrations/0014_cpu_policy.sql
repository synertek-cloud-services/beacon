-- Seed global default policy — CPU Usage
-- Two monitors per Datto's own recommended pattern: a hard 100% critical
-- trip plus a lower early-warning threshold, since a device pinned at
-- 100% CPU can become too unresponsive to reliably report/alert on.
-- Ships enabled. Operators can disable or override per-company via the UI.

INSERT INTO policies (id, name, description, scope, target_os, target_class, created_at, updated_at)
VALUES (
  'policy-cpu',
  'CPU Usage',
  'Alert on sustained high CPU usage — critical at 100%, early warning at 95%',
  'global',
  '["windows","linux","macos"]',
  '["server","workstation","laptop"]',
  unixepoch(), unixepoch()
);

INSERT INTO policy_monitors (id, policy_id, check_type, config, alert_priority, sustained_minutes, auto_resolve, auto_resolve_after_minutes, created_at)
VALUES
  ('pm-cpu-critical',
   'policy-cpu', 'cpu_usage',
   '{"percent_max":100}',
   'critical', 5, 1, 15, unixepoch()),

  ('pm-cpu-warning',
   'policy-cpu', 'cpu_usage',
   '{"percent_max":95}',
   'high', 15, 1, 30, unixepoch());
