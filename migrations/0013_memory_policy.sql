-- Seed global default policy — Memory Usage
-- Ships enabled. Operators can disable or override per-company via the UI.

INSERT INTO policies (id, name, description, scope, target_os, target_class, created_at, updated_at)
VALUES (
  'policy-memory',
  'Memory Usage',
  'Alert when memory usage stays above 90% for a sustained period',
  'global',
  '["windows","linux","macos"]',
  '["server","workstation","laptop"]',
  unixepoch(), unixepoch()
);

INSERT INTO policy_monitors (id, policy_id, check_type, config, alert_priority, sustained_minutes, auto_resolve, auto_resolve_after_minutes, created_at)
VALUES (
  'pm-memory',
  'policy-memory', 'memory_usage',
  '{"percent_max":90}',
  'high', 10, 1, 30, unixepoch()
);
