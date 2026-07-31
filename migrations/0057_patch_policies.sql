-- Patch Policy: severity-threshold auto-approval rules plus recurring
-- scheduled install windows -- the last piece explicitly scoped-but-not-
-- built in Patch Management. Recurrence columns are a verbatim duplicate
-- of maintenance_policies (migration 0050), not shared, matching this
-- codebase's established per-policy-type mirroring convention. Unlike
-- Maintenance Policy's passive suppression gate, Patch Policy needs active
-- cron dispatch (like Jobs' scheduled type) -- last_dispatched_at is the
-- one new piece of state that requires, tracking the most recent dispatch
-- so a recurring weekly window fires exactly once per continuous active
-- occurrence rather than once per 2-minute cron tick. See
-- worker/src/lib/patchPolicies.ts.
CREATE TABLE patch_policies (
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
  -- NULL = no auto-approval rule, this policy only ever installs patches
  -- someone approved manually. Free text, not a DB enum -- severity itself
  -- is free text throughout patch_approvals/the WUA-sourced data.
  min_severity              TEXT    CHECK (min_severity IS NULL OR min_severity IN ('Critical', 'Important', 'Moderate', 'Low')),
  -- Default false = Datto's own "Do not restart" default. When true, a
  -- policy-dispatched install that reports RebootRequired skips the
  -- interactive tray notification (Step 3) and reboots immediately instead.
  auto_reboot               INTEGER NOT NULL DEFAULT 0,
  last_dispatched_at        INTEGER,
  created_at                INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE patch_policy_sites (
  policy_id  TEXT    NOT NULL REFERENCES patch_policies(id) ON DELETE CASCADE,
  tenant_id  TEXT    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (policy_id, tenant_id)
);
CREATE INDEX idx_patch_policy_sites_tenant ON patch_policy_sites(tenant_id);

CREATE TABLE patch_policy_devices (
  policy_id  TEXT    NOT NULL REFERENCES patch_policies(id) ON DELETE CASCADE,
  device_id  TEXT    NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (policy_id, device_id)
);
CREATE INDEX idx_patch_policy_devices_device ON patch_policy_devices(device_id);

CREATE TABLE patch_policy_groups (
  policy_id  TEXT    NOT NULL REFERENCES patch_policies(id) ON DELETE CASCADE,
  group_id   TEXT    NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (policy_id, group_id)
);
CREATE INDEX idx_patch_policy_groups_group ON patch_policy_groups(group_id);
