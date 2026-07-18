-- Host-level product identity: white-labeled name and logo mark, decoupled
-- from branding_settings' theme-activation pointer (one table per concern).
CREATE TABLE branding_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  product_name TEXT NOT NULL DEFAULT '',
  logo_key TEXT,
  updated_at INTEGER NOT NULL
);

INSERT INTO branding_identity (id, product_name, logo_key, updated_at)
VALUES (1, '', NULL, unixepoch());
