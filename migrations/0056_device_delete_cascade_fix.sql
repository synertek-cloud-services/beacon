-- Fix: DELETE /v1/admin/devices/:id threw an unhandled foreign-key
-- constraint error (surfaced to the dashboard as a 500) for any device that
-- had ever generated an alert, a remote session, an audit, or a command --
-- i.e. any device that had actually been in real use. Each of those tables'
-- device_id FK had no ON DELETE clause, defaulting to NO ACTION, and D1
-- enforces foreign keys. Same root cause and same fix shape as migration
-- 0018 (commands.component_id), just for device_id across five tables that
-- predate the ON DELETE CASCADE convention later tables (policy_devices,
-- device_custom_field_values, device_group_members, maintenance_policy_devices)
-- already followed. SQLite can't ALTER a column's FK constraint in place, so
-- each table is recreated with the same columns/other constraints, just
-- device_id switched to CASCADE.

CREATE TABLE alert_state_new (
  id                   TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_id            TEXT    NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  policy_monitor_id    TEXT    NOT NULL REFERENCES policy_monitors(id) ON DELETE CASCADE,
  condition_first_seen INTEGER,
  is_alerting          INTEGER NOT NULL DEFAULT 0,
  alerted_at           INTEGER,
  alert_priority       TEXT,
  resolved_at          INTEGER,
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(device_id, policy_monitor_id)
);
INSERT INTO alert_state_new
  (id, device_id, policy_monitor_id, condition_first_seen, is_alerting, alerted_at, alert_priority, resolved_at, updated_at)
SELECT
  id, device_id, policy_monitor_id, condition_first_seen, is_alerting, alerted_at, alert_priority, resolved_at, updated_at
FROM alert_state;
DROP TABLE alert_state;
ALTER TABLE alert_state_new RENAME TO alert_state;
CREATE INDEX idx_alert_state_device   ON alert_state(device_id);
CREATE INDEX idx_alert_state_alerting ON alert_state(is_alerting);

CREATE TABLE sessions_new (
  id              TEXT    PRIMARY KEY NOT NULL,
  device_id       TEXT    NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tenant_id       TEXT    NOT NULL REFERENCES tenants(id),
  session_type    TEXT    NOT NULL,
  tcp_port        INTEGER,
  status          TEXT    NOT NULL DEFAULT 'pending',
  created_at      INTEGER NOT NULL,
  closed_at       INTEGER,
  client_auth_hash TEXT
);
INSERT INTO sessions_new
  (id, device_id, tenant_id, session_type, tcp_port, status, created_at, closed_at, client_auth_hash)
SELECT
  id, device_id, tenant_id, session_type, tcp_port, status, created_at, closed_at, client_auth_hash
FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE TABLE commands_new (
  id              TEXT    PRIMARY KEY NOT NULL,
  device_id       TEXT    NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tenant_id       TEXT    NOT NULL REFERENCES tenants(id),
  type            TEXT    NOT NULL,
  payload         TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'queued',
  result          TEXT,
  warning         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  job_id          TEXT REFERENCES jobs(id),
  component_id    TEXT REFERENCES components(id) ON DELETE SET NULL,
  component_order INTEGER NOT NULL DEFAULT 1
);
INSERT INTO commands_new
  (id, device_id, tenant_id, type, payload, status, result, warning, created_at, completed_at, job_id, component_id, component_order)
SELECT
  id, device_id, tenant_id, type, payload, status, result, warning, created_at, completed_at, job_id, component_id, component_order
FROM commands;
DROP TABLE commands;
ALTER TABLE commands_new RENAME TO commands;

-- device_audits/device_audit_changes need extra care: device_audit_changes
-- itself references device_audits(id) (no cascade), so SQLite refuses to
-- DROP TABLE device_audits while any table still has live rows pointing at
-- it under that name -- confirmed by hand while writing this migration, not
-- assumed. A plain staging table (D1 rejects CREATE TEMP TABLE outright --
-- SQLITE_AUTH -- also confirmed by hand, not assumed) sidesteps this: it
-- holds the old device_audit_changes data across the device_audits rebuild
-- without itself carrying a live FK to device_audits, so nothing blocks the
-- DROP. Dropped again at the end of this block once its data has been
-- copied into the real, FK-constrained device_audit_changes_new.
CREATE TABLE dac_staging AS SELECT * FROM device_audit_changes;
DROP TABLE device_audit_changes;

CREATE TABLE device_audits_new (
  id            TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_id     TEXT    NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tenant_id     TEXT    NOT NULL REFERENCES tenants(id),
  audit_type    TEXT    NOT NULL DEFAULT 'full',
  hardware      TEXT,
  software      TEXT,
  services      TEXT,
  security      TEXT,
  patches       TEXT,
  agent_version TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO device_audits_new
  (id, device_id, tenant_id, audit_type, hardware, software, services, security, patches, agent_version, created_at)
SELECT
  id, device_id, tenant_id, audit_type, hardware, software, services, security, patches, agent_version, created_at
FROM device_audits;
DROP TABLE device_audits;
ALTER TABLE device_audits_new RENAME TO device_audits;
CREATE INDEX idx_device_audits_device_created ON device_audits(device_id, created_at DESC);

-- audit_id now cascades too (migration comment above explains why this
-- table needed the staging dance): deleting an audit snapshot should take
-- its own diff/change-log entries with it, same reasoning as device_id.
CREATE TABLE device_audit_changes_new (
  id           TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_id    TEXT    NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tenant_id    TEXT    NOT NULL REFERENCES tenants(id),
  audit_id     TEXT    NOT NULL REFERENCES device_audits(id) ON DELETE CASCADE,
  category     TEXT    NOT NULL,
  change_type  TEXT    NOT NULL,
  item_name    TEXT    NOT NULL,
  field        TEXT,
  old_value    TEXT,
  new_value    TEXT,
  detected_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO device_audit_changes_new
  (id, device_id, tenant_id, audit_id, category, change_type, item_name, field, old_value, new_value, detected_at)
SELECT
  id, device_id, tenant_id, audit_id, category, change_type, item_name, field, old_value, new_value, detected_at
FROM dac_staging;
DROP TABLE dac_staging;
ALTER TABLE device_audit_changes_new RENAME TO device_audit_changes;
CREATE INDEX idx_audit_changes_device ON device_audit_changes(device_id, detected_at DESC);
