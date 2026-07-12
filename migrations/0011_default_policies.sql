-- Seed global default policies — AV Health, Disk Space, Device Offline
-- These ship enabled. Operators can disable or override per-company via the UI.

-- ── Antivirus Health (3 monitors — one per av_state) ─────────────────────────
INSERT INTO policies (id, name, description, scope, target_os, target_class, created_at, updated_at)
VALUES (
  'policy-av-health',
  'Antivirus Health',
  'Alert when antivirus is missing, stopped, or out of date',
  'global',
  '["windows","linux"]',
  '["server","workstation","laptop"]',
  unixepoch(), unixepoch()
);

INSERT INTO policy_monitors (id, policy_id, check_type, config, alert_priority, sustained_minutes, auto_resolve, auto_resolve_after_minutes, created_at)
VALUES
  -- Critical: no AV at all — fire fast, resolve fast
  ('pm-av-not-detected',
   'policy-av-health', 'av_status',
   '{"av_state":"not_detected"}',
   'critical', 5, 1, 15, unixepoch()),

  -- High: AV registered but not running/disabled
  ('pm-av-not-running',
   'policy-av-health', 'av_status',
   '{"av_state":"not_running"}',
   'high', 10, 1, 15, unixepoch()),

  -- Moderate: AV running but definitions are stale (longer window — defs lag after boot)
  ('pm-av-out-of-date',
   'policy-av-health', 'av_status',
   '{"av_state":"running_not_up_to_date"}',
   'moderate', 60, 1, 60, unixepoch());

-- ── Disk Space ────────────────────────────────────────────────────────────────
INSERT INTO policies (id, name, description, scope, target_os, target_class, created_at, updated_at)
VALUES (
  'policy-disk-space',
  'Disk Space',
  'Alert when free disk space falls below 10 GB',
  'global',
  '["windows","linux","macos"]',
  '["server","workstation","laptop"]',
  unixepoch(), unixepoch()
);

INSERT INTO policy_monitors (id, policy_id, check_type, config, alert_priority, sustained_minutes, auto_resolve, auto_resolve_after_minutes, created_at)
VALUES (
  'pm-disk-space',
  'policy-disk-space', 'disk_space',
  '{"bytes_free_min":10737418240}',
  'high', 5, 1, 120, unixepoch()
);

-- ── Device Offline ────────────────────────────────────────────────────────────
INSERT INTO policies (id, name, description, scope, target_os, target_class, created_at, updated_at)
VALUES (
  'policy-offline',
  'Device Offline',
  'Alert when a device has not checked in for 30 minutes',
  'global',
  '["windows","linux","macos"]',
  '["server","workstation","laptop"]',
  unixepoch(), unixepoch()
);

INSERT INTO policy_monitors (id, policy_id, check_type, config, alert_priority, sustained_minutes, auto_resolve, auto_resolve_after_minutes, created_at)
VALUES (
  'pm-offline',
  'policy-offline', 'offline',
  '{"offline_after_seconds":1800}',
  'high', 0, 1, 30, unixepoch()
);
