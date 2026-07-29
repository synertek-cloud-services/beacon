-- Host-wide singleton settings -- currently just the Maintenance-Policy
-- scheduling timezone (Datto: Setup > Account Settings > Time Zone, one
-- value for the whole account, no per-tenant override). Same id=1 CHECK
-- singleton shape as email_settings/branding_settings/branding_identity.
CREATE TABLE host_settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  timezone   TEXT    NOT NULL DEFAULT 'UTC',
  updated_at INTEGER NOT NULL
);

INSERT INTO host_settings (id, timezone, updated_at) VALUES (1, 'UTC', unixepoch());
