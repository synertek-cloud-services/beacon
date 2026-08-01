-- Company Variables/Secrets: per-Company key/value config, referenceable from
-- component scripts as CV_<KEY> (resolved per-device at job dispatch time,
-- same pattern as Custom Fields' CF_<KEY>). Two kinds, mirroring Cloudflare
-- Workers vars/secrets and GitHub Actions variables/secrets: plain variables
-- (value stored in cleartext, always visible) and secrets (AES-GCM encrypted
-- at rest via CONFIG_ENCRYPTION_KEY, same as sso_providers/email_settings --
-- never returned in plaintext by any read endpoint once saved).
CREATE TABLE company_variables (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key               TEXT NOT NULL,
  is_secret         INTEGER NOT NULL DEFAULT 0,
  value             TEXT, -- plain value, only when is_secret = 0
  value_ciphertext  TEXT, -- AES-GCM ciphertext, only when is_secret = 1
  value_nonce       TEXT,
  description       TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE(company_id, key)
);

CREATE INDEX idx_company_variables_company ON company_variables(company_id);
