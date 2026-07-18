-- Custom fields: add a `key` identifier column, separate from the freeform
-- display `name` (mirrors component_variables' name/label split), so a
-- component script can reference a specific device's custom field value
-- directly via a fixed CF_<KEY> environment variable at job dispatch time --
-- Datto's UDF_<N> convention, adapted to Beacon's named (not numbered) fields.
-- SQLite can't add a UNIQUE column via ALTER TABLE, so: add the column with
-- a non-unique DEFAULT '' first, then a partial unique index -- existing rows
-- (and any field a user hasn't given a key yet) keep key='' and don't
-- collide with each other; only real (non-empty) keys are enforced unique.
ALTER TABLE custom_fields ADD COLUMN key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_custom_fields_key ON custom_fields(key) WHERE key != '';
