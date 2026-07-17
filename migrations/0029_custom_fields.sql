-- Dynamic custom fields ("UDF" equivalent) — admin-defined named fields,
-- values stored per device. Not Datto's 300 fixed numbered slots; a proper
-- join table (not a JSON blob on devices) so a future filter/targeting pass
-- doesn't need a schema change.

CREATE TABLE custom_fields (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE device_custom_field_values (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, field_id)
);
