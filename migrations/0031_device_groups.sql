-- Device Groups: a static, manually-curated, named collection of individual
-- devices (Datto RMM's "Groups" concept, adapted -- not the dynamic "Filter"
-- half of that system, and not a group-of-sites, since Jobs can already
-- target multiple sites directly). Used to target both Jobs and Monitoring
-- Policies.
CREATE TABLE device_groups (
  id          TEXT    NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name        TEXT    NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Membership: a pure association with no independent row identity ever
-- referenced, so a composite PK is the better fit than component_sites'
-- synthetic-id + separate UNIQUE constraint -- matches the more recently
-- established device_custom_field_values pattern.
CREATE TABLE device_group_members (
  group_id   TEXT    NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
  device_id  TEXT    NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (group_id, device_id)
);
CREATE INDEX idx_device_group_members_device ON device_group_members(device_id);

-- Policy targeting: zero rows for a policy = unchanged (scope/OS/class-only)
-- behavior; one or more rows = device must ALSO belong to at least one of
-- the referenced groups (ANDed with existing scope/OS/class checks, ORed
-- across the groups themselves -- matches Datto's own documented "multiple
-- targets = OR logic" behavior).
CREATE TABLE policy_groups (
  policy_id  TEXT    NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  group_id   TEXT    NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (policy_id, group_id)
);
CREATE INDEX idx_policy_groups_group ON policy_groups(group_id);
