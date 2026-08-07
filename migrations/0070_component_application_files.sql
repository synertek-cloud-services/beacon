-- Application Components remain ordinary Components. Files are private R2
-- objects described here; the Worker authorizes every endpoint download.
CREATE TABLE component_files (
  id TEXT PRIMARY KEY,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_type TEXT,
  architecture TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX component_files_component_id_idx ON component_files(component_id);

-- A Component with type = 'application' has exactly one settings row. The
-- installer file remains a normal component_files child so supplemental files
-- stage beside it without creating a separate package/catalog model.
CREATE TABLE component_applications (
  component_id TEXT PRIMARY KEY REFERENCES components(id) ON DELETE CASCADE,
  installer_file_id TEXT NOT NULL REFERENCES component_files(id),
  installer_arguments TEXT NOT NULL DEFAULT '[]',
  timeout_seconds INTEGER NOT NULL DEFAULT 900,
  detection_type TEXT NOT NULL DEFAULT 'none',
  detection_value TEXT,
  architecture TEXT NOT NULL DEFAULT 'amd64',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
