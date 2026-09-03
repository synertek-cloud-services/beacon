-- Pinned RustDesk installer (singleton, mirrors rustdesk_settings/branding_identity).
-- Beacon hosts a specific version rather than trusting a live fetch from
-- RustDesk's own CDN at install time -- same trust model as Application
-- Components' file delivery.
CREATE TABLE rustdesk_installer (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  object_key TEXT,
  version TEXT,
  sha256 TEXT,
  size_bytes INTEGER,
  uploaded_at INTEGER
);
INSERT INTO rustdesk_installer (id, object_key, version, sha256, size_bytes, uploaded_at)
VALUES (1, NULL, NULL, NULL, NULL, NULL);

-- Short-lived, single-use grant for the agent to download the pinned
-- installer during an install_rustdesk command -- same shape as
-- component_file_downloads, kept as its own table rather than reusing that
-- one directly since component_file_downloads is FK'd to component_files
-- (an Application Component's own file), which the RustDesk installer
-- isn't. Grant is inserted already-expired, same as component_file_downloads,
-- and only becomes usable once checkin.ts marks the matching command sent.
CREATE TABLE rustdesk_installer_downloads (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  downloaded_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rustdesk_installer_downloads_device ON rustdesk_installer_downloads(device_id);
CREATE INDEX idx_rustdesk_installer_downloads_command ON rustdesk_installer_downloads(command_id);

-- Encrypted unattended-access password, same ciphertext/nonce column-pair
-- shape company_variables/email_settings already use. Permanent record for
-- the dashboard's later "reveal password" action -- separate from the
-- short-lived grant below, which is for the agent's one-time redemption
-- during install.
ALTER TABLE devices ADD COLUMN rustdesk_password_ciphertext TEXT;
ALTER TABLE devices ADD COLUMN rustdesk_password_nonce TEXT;

-- Short-lived, single-use grant for the agent to redeem the plaintext
-- password exactly once during install -- mirrors
-- rustdesk_installer_downloads' shape exactly, just granting a
-- decrypt-on-redeem instead of an R2 object.
CREATE TABLE rustdesk_password_grants (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rustdesk_password_grants_device ON rustdesk_password_grants(device_id);
CREATE INDEX idx_rustdesk_password_grants_command ON rustdesk_password_grants(command_id);
