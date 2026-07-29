-- Maintenance Policy (v1: 'one_time' + 'weekly' recurrence only) -- fleet-wide
-- scheduled alert suppression alongside the existing per-device ad-hoc
-- maintenance window (devices.maintenance_ends_at, migration 0025, untouched
-- by this migration). Targeting mirrors policy_sites/policy_devices/
-- policy_groups (0031/0032) exactly as independent parallel tables -- a
-- different policy type with its own targeting. No OS/Class gate -- Datto's
-- real Maintenance Policy has no such filter. See
-- worker/src/lib/maintenance.ts for how these fields are evaluated.
CREATE TABLE maintenance_policies (
  id                        TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name                      TEXT    NOT NULL,
  description               TEXT,
  enabled                   INTEGER NOT NULL DEFAULT 1,
  recurrence_type           TEXT    NOT NULL CHECK (recurrence_type IN ('one_time', 'weekly')),
  one_time_start_at         INTEGER,
  one_time_duration_minutes INTEGER,
  weekly_days               TEXT,
  weekly_start_minute       INTEGER,
  weekly_duration_minutes   INTEGER,
  created_at                INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE maintenance_policy_sites (
  policy_id  TEXT    NOT NULL REFERENCES maintenance_policies(id) ON DELETE CASCADE,
  tenant_id  TEXT    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (policy_id, tenant_id)
);
CREATE INDEX idx_maintenance_policy_sites_tenant ON maintenance_policy_sites(tenant_id);

CREATE TABLE maintenance_policy_devices (
  policy_id  TEXT    NOT NULL REFERENCES maintenance_policies(id) ON DELETE CASCADE,
  device_id  TEXT    NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (policy_id, device_id)
);
CREATE INDEX idx_maintenance_policy_devices_device ON maintenance_policy_devices(device_id);

CREATE TABLE maintenance_policy_groups (
  policy_id  TEXT    NOT NULL REFERENCES maintenance_policies(id) ON DELETE CASCADE,
  group_id   TEXT    NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (policy_id, group_id)
);
CREATE INDEX idx_maintenance_policy_groups_group ON maintenance_policy_groups(group_id);
