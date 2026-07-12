-- Replace flat alert_definitions model with two-tier policies + policy_monitors
-- Global policies apply to all companies; company-scoped policies override global

CREATE TABLE policies (
  id           TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name         TEXT    NOT NULL,
  description  TEXT,
  scope        TEXT    NOT NULL DEFAULT 'global',  -- 'global' | 'company'
  company_id   TEXT    REFERENCES tenants(id),     -- NULL for global scope
  enabled      INTEGER NOT NULL DEFAULT 1,
  -- JSON arrays of OS types and device classes this policy targets
  -- e.g. '["windows","linux"]' and '["server","workstation","laptop"]'
  -- Empty array means "all"
  target_os    TEXT    NOT NULL DEFAULT '["windows","linux","macos"]',
  target_class TEXT    NOT NULL DEFAULT '["server","workstation","laptop"]',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_policies_scope   ON policies(scope);
CREATE INDEX idx_policies_company ON policies(company_id);

CREATE TABLE policy_monitors (
  id                         TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  policy_id                  TEXT    NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  check_type                 TEXT    NOT NULL, -- 'disk_space'|'offline'|'cpu_usage'|'memory_usage'|'av_status'
  enabled                    INTEGER NOT NULL DEFAULT 1,
  config                     TEXT    NOT NULL DEFAULT '{}', -- JSON, shape varies by check_type
  alert_priority             TEXT    NOT NULL DEFAULT 'high',
  sustained_minutes          INTEGER NOT NULL DEFAULT 5,
  auto_resolve               INTEGER NOT NULL DEFAULT 1,
  auto_resolve_after_minutes INTEGER NOT NULL DEFAULT 60,
  created_at                 INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_policy_monitors_policy ON policy_monitors(policy_id);

-- Drop old flat tables (no production data to preserve)
DROP TABLE IF EXISTS alert_state;
DROP TABLE IF EXISTS alert_definitions;

-- New alert_state references policy_monitors and tracks condition_first_seen
-- for proper time-based sustained_minutes evaluation
CREATE TABLE alert_state (
  id                   TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_id            TEXT    NOT NULL REFERENCES devices(id),
  policy_monitor_id    TEXT    NOT NULL REFERENCES policy_monitors(id) ON DELETE CASCADE,
  condition_first_seen INTEGER,          -- unix ts when failure condition was first observed
  is_alerting          INTEGER NOT NULL DEFAULT 0,
  alerted_at           INTEGER,          -- when the alert was first raised
  resolved_at          INTEGER,          -- when it last resolved
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(device_id, policy_monitor_id)
);
CREATE INDEX idx_alert_state_device   ON alert_state(device_id);
CREATE INDEX idx_alert_state_alerting ON alert_state(is_alerting);
