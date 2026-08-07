-- Per-command, per-device capability grants for private component-file downloads.
-- The raw token is placed only in the queued command payload; this table stores
-- its SHA-256 hash so a database read never reveals a reusable download token.
CREATE TABLE component_file_downloads (
  id TEXT PRIMARY KEY,
  component_file_id TEXT NOT NULL REFERENCES component_files(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  downloaded_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX component_file_downloads_device_idx ON component_file_downloads(device_id);
CREATE INDEX component_file_downloads_command_idx ON component_file_downloads(command_id);
