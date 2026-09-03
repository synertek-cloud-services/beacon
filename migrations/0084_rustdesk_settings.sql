-- Global RustDesk relay/rendezvous server config (issue TBD -- "Full Remote
-- Control" tier, deferred since the original Remote Shell session). All
-- three fields nullable and empty by default -- an empty config means
-- devices use RustDesk's own public ID/relay servers, no self-hosted
-- infrastructure required. A self-hoster can point at their own hbbs/hbbr
-- later by filling these in; the agent-side install work (not yet built)
-- will pass id_server/relay_server/key to the client via RustDesk's own
-- --config import when set, and leave the client on public defaults when
-- not.
CREATE TABLE rustdesk_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  id_server TEXT,
  relay_server TEXT,
  key TEXT,
  updated_at INTEGER NOT NULL
);

INSERT INTO rustdesk_settings (id, id_server, relay_server, key, updated_at)
VALUES (1, NULL, NULL, NULL, unixepoch());

-- Per-company opt-in for the RustDesk "Full Remote Control" tier -- off by
-- default, nothing changes for any existing company. No per-device
-- override yet (unlike remote_access_consent_override) -- add one later
-- only if a real need shows up, matching this codebase's own
-- don't-build-ahead-of-demand precedent (see PROJECT_LOG's #117 rewrite).
ALTER TABLE companies ADD COLUMN rustdesk_enabled INTEGER NOT NULL DEFAULT 0;
