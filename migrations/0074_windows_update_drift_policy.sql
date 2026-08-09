-- Seed global default policy — Windows Update Drift
-- Detects a domain GPO or local administrator re-enabling Windows' own
-- Automatic Updates client after Beacon disabled it (NoAutoUpdate=1), which
-- would let it install an unapproved update or reboot outside a configured
-- window, undercutting the approval/scheduling model. Only ever assigned to
-- devices Beacon currently manages (windowsUpdateManaged=true) — see
-- CLAUDE.md's Patch Management section (issue #79). Ships enabled.
-- Operators can disable or override per-company via the UI.

INSERT INTO policies (id, name, description, scope, target_os, target_class, created_at, updated_at)
VALUES (
  'policy-windows-update-drift',
  'Windows Update Drift',
  'Alert when Windows'' own Automatic Updates is re-enabled after Beacon disabled it (GPO or local override)',
  'global',
  '["windows"]',
  '["server","workstation","laptop"]',
  unixepoch(), unixepoch()
);

-- check_interval_minutes is set explicitly here -- the schema column
-- defaults to 1, not the 15 this seed wants (that ??1 fallback only applies
-- to the admin API's own POST handler, not a raw seed INSERT).
INSERT INTO policy_monitors (id, policy_id, check_type, config, alert_priority, sustained_minutes, check_interval_minutes, auto_resolve, auto_resolve_after_minutes, created_at)
VALUES (
  'pm-windows-update-drift',
  'policy-windows-update-drift', 'windows_update_drift',
  '{}',
  'high', 30, 15, 1, 60, unixepoch()
);
