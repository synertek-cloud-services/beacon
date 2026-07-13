-- Multi-user auth: local password accounts + Microsoft Entra ID SSO, global RBAC roles.
-- Replaces the single shared ADMIN_SECRET model (kept as a break-glass fallback in app code).
--
-- Table naming notes:
-- - `user_sessions`, not `sessions` — that name is already taken by device
--   remote-shell/tcp-tunnel sessions.
-- - `sso_providers.directory_id` is Microsoft Entra's directory (tenant) id — deliberately
--   NOT named `tenant_id`, since that word already means "client company" elsewhere
--   (see `policies.company_id` referencing `tenants`).

CREATE TABLE sso_providers (
  id                       TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  type                     TEXT    NOT NULL DEFAULT 'microsoft', -- 'microsoft' implemented; 'google' reserved (v2)
  name                     TEXT    NOT NULL,
  directory_id             TEXT    NOT NULL, -- Entra directory (tenant) id
  client_id                TEXT    NOT NULL,
  client_secret_ciphertext TEXT    NOT NULL, -- AES-GCM ciphertext, base64
  client_secret_nonce      TEXT    NOT NULL, -- AES-GCM 12-byte nonce, base64
  enabled                  INTEGER NOT NULL DEFAULT 1,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sso_group_role_mappings (
  id              TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  sso_provider_id TEXT    NOT NULL REFERENCES sso_providers(id) ON DELETE CASCADE,
  group_id        TEXT    NOT NULL, -- Entra security group object id
  group_name      TEXT,             -- cached display name, cosmetic only
  role            TEXT    NOT NULL, -- 'admin' | 'technician' | 'readonly'
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(sso_provider_id, group_id)
);
CREATE INDEX idx_sso_group_mappings_provider ON sso_group_role_mappings(sso_provider_id);

-- Short-lived, single-use CSRF/PKCE state for the OAuth redirect flow. No server-side
-- user session exists yet at this point, so this D1 row (not a signed cookie) is the
-- source of truth — id itself IS the `state` value sent to Microsoft, consistent with
-- this codebase's existing "random id as unguessable capability" pattern.
CREATE TABLE sso_login_state (
  id              TEXT    PRIMARY KEY, -- app-generated random hex, used directly as OAuth `state`
  sso_provider_id TEXT    NOT NULL REFERENCES sso_providers(id),
  code_verifier   TEXT    NOT NULL, -- PKCE
  redirect_uri    TEXT    NOT NULL, -- dashboard SPA origin to bounce back to
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at      INTEGER NOT NULL
);

CREATE TABLE users (
  id              TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email           TEXT    NOT NULL,
  display_name    TEXT,
  role            TEXT    NOT NULL DEFAULT 'readonly', -- 'admin' | 'technician' | 'readonly'
  -- Self-describing: "pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>". NULL for SSO-only users.
  password_hash   TEXT,
  auth_source     TEXT    NOT NULL DEFAULT 'local', -- 'local' | 'microsoft'
  sso_provider_id TEXT    REFERENCES sso_providers(id),
  sso_subject     TEXT,   -- Entra object id (`oid` claim); NULL for local accounts
  status          TEXT    NOT NULL DEFAULT 'active', -- 'active' | 'disabled'
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at   INTEGER,
  created_by      TEXT
);
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_sso_identity ON users(sso_provider_id, sso_subject) WHERE sso_subject IS NOT NULL;

CREATE TABLE user_sessions (
  id           TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT    NOT NULL REFERENCES users(id),
  token_hash   TEXT    NOT NULL UNIQUE, -- sha256hex(raw token) — same convention as enrollment_tokens.token_hash
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);

-- One-time code handed to the SPA in the final redirect's query string, so the real
-- Beacon session token never appears in a URL. The SPA immediately POSTs this code to
-- /v1/auth/microsoft/exchange to get the token.
CREATE TABLE sso_exchange_codes (
  id            TEXT    PRIMARY KEY, -- app-generated random hex, the `xchg` param
  session_token TEXT    NOT NULL,    -- raw (unhashed) session token, single-use, ~60s TTL
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at    INTEGER NOT NULL
);

-- Remote shell/tcp-tunnel sessions (`sessions` table) previously authenticated their
-- WebSocket client leg with the raw ADMIN_SECRET embedded in the ws:// URL. Now that
-- technicians (who never hold ADMIN_SECRET) can open sessions too, each session gets
-- its own random client auth token instead — same "hash at rest, never store raw"
-- convention as enrollment_tokens.token_hash.
ALTER TABLE sessions ADD COLUMN client_auth_hash TEXT;
