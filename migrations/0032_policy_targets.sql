-- Multi-site + individual-device targeting for Monitoring Policies, joining
-- the existing policy_groups (0031) as the third targeting dimension. All
-- three are OR'd together (a device matches if it satisfies ANY entry, of
-- ANY kind) -- zero rows across all three tables means unrestricted, the
-- same "zero rows = unchanged" precedent policy_groups established,
-- generalized. See deviceMatchesPolicy in worker/src/lib/alerts.ts.
CREATE TABLE policy_sites (
  policy_id  TEXT    NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  tenant_id  TEXT    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (policy_id, tenant_id)
);
CREATE INDEX idx_policy_sites_tenant ON policy_sites(tenant_id);

CREATE TABLE policy_devices (
  policy_id  TEXT    NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  device_id  TEXT    NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (policy_id, device_id)
);
CREATE INDEX idx_policy_devices_device ON policy_devices(device_id);

-- Backfill: every existing scope='company' single-site policy becomes a
-- one-row policy_sites entry. policies.company_id becomes vestigial after
-- this (same fate as components.company_id after migration 0022) -- left in
-- place, not worth a DROP COLUMN for a column nothing writes going forward.
INSERT INTO policy_sites (policy_id, tenant_id, created_at)
SELECT id, company_id, unixepoch() FROM policies
WHERE scope = 'company' AND company_id IS NOT NULL;
