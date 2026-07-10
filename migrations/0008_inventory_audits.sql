-- Full inventory audit snapshots per device
CREATE TABLE device_audits (
  id            TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_id     TEXT    NOT NULL REFERENCES devices(id),
  tenant_id     TEXT    NOT NULL REFERENCES tenants(id),
  audit_type    TEXT    NOT NULL DEFAULT 'full',
  hardware      TEXT,   -- JSON: { cpu, ram, disks, network, bios }
  software      TEXT,   -- JSON: [{ name, version, publisher, installed_at }]
  services      TEXT,   -- JSON: [{ name, display_name, status, start_type }]
  security      TEXT,   -- JSON: { antivirus, firewall_enabled }
  agent_version TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_device_audits_device_created
  ON device_audits(device_id, created_at DESC);

-- Change log entries derived by diffing consecutive audits
CREATE TABLE device_audit_changes (
  id           TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_id    TEXT    NOT NULL REFERENCES devices(id),
  tenant_id    TEXT    NOT NULL REFERENCES tenants(id),
  audit_id     TEXT    NOT NULL REFERENCES device_audits(id),
  category     TEXT    NOT NULL,  -- 'hardware' | 'software' | 'services' | 'security'
  change_type  TEXT    NOT NULL,  -- 'added' | 'removed' | 'changed'
  item_name    TEXT    NOT NULL,
  field        TEXT,
  old_value    TEXT,
  new_value    TEXT,
  detected_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_audit_changes_device
  ON device_audit_changes(device_id, detected_at DESC);
