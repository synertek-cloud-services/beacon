-- Alert notifications: global webhooks (drop the never-UI'd per-company
-- scoping) plus a pluggable email provider and two unioned recipient
-- sources (opted-in Beacon users, and a standalone address list).

-- webhook_endpoints was per-company (tenant_id) but never had any UI built
-- against that shape -- the hoster's own team reads alerts, not the client
-- company, so this becomes a flat global list.
CREATE TABLE webhook_endpoints_new (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

INSERT INTO webhook_endpoints_new (id, url, enabled, created_at)
SELECT id, url, enabled, created_at FROM webhook_endpoints;

DROP TABLE webhook_endpoints;
ALTER TABLE webhook_endpoints_new RENAME TO webhook_endpoints;

-- Recipient source 1: existing Beacon accounts, opt-in.
ALTER TABLE users ADD COLUMN receives_alerts INTEGER NOT NULL DEFAULT 0;

-- Recipient source 2: standalone addresses with no Beacon account (a shared
-- mailbox, a ticketing system's inbound address, etc.).
CREATE TABLE notification_emails (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Singleton active email provider config, mirrors branding_identity's shape.
CREATE TABLE email_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT,
  from_address TEXT,
  config_ciphertext TEXT,
  config_nonce TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

INSERT INTO email_settings (id, provider, from_address, config_ciphertext, config_nonce, enabled, updated_at)
VALUES (1, NULL, NULL, NULL, NULL, 0, unixepoch());
