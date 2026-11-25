-- Opt-in switches for the features that spend Cloudflare free-tier budget
-- (docs/SCALABILITY_DESIGN.md). One column per feature on the host_settings
-- singleton; read through lib/features.ts.
ALTER TABLE host_settings ADD COLUMN feature_discovery INTEGER NOT NULL DEFAULT 0;
ALTER TABLE host_settings ADD COLUMN feature_application_components INTEGER NOT NULL DEFAULT 0;
ALTER TABLE host_settings ADD COLUMN feature_webhooks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE host_settings ADD COLUMN feature_os_update_management INTEGER NOT NULL DEFAULT 0;
ALTER TABLE host_settings ADD COLUMN feature_agent_monitors INTEGER NOT NULL DEFAULT 0;

-- An install that already has devices predates the switches: keep everything
-- it could already do turned on. A fresh install (no devices yet) starts off.
UPDATE host_settings SET
  feature_discovery = 1,
  feature_application_components = 1,
  feature_webhooks = 1,
  feature_os_update_management = 1,
  feature_agent_monitors = 1
WHERE EXISTS (SELECT 1 FROM devices);
