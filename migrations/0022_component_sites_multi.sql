-- Datto's real "Sites" model lets a component be restricted to MULTIPLE
-- sites, not a single company — 0021's components.scope/company_id was a
-- single-company simplification that turned out not to match the reference
-- UI (an "Add Site" flyout that adds one site at a time to a list). Replace
-- with a proper many-to-many join table. components.company_id becomes
-- vestigial/unused — it shipped moments before this fix with zero real
-- production usage, so it's left in place rather than attempting a
-- DROP COLUMN for a column nothing has ever written meaningfully.
CREATE TABLE component_sites (
  id           TEXT    NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  component_id TEXT    NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  tenant_id    TEXT    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(component_id, tenant_id)
);
CREATE INDEX idx_component_sites_component ON component_sites(component_id);
CREATE INDEX idx_component_sites_tenant ON component_sites(tenant_id);
