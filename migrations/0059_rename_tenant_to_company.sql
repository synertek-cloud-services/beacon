-- Terminology rename: "Tenant" -> "Company" throughout the schema, matching
-- the product's own UI vocabulary (the sidebar has said "Companies" since
-- long before this migration; the schema/API just never caught up). Verified
-- empirically against local D1 before writing this: ALTER TABLE ... RENAME TO
-- and ALTER TABLE ... RENAME COLUMN ... TO ... both work cleanly on D1 and
-- automatically rewrite REFERENCES clauses in dependent tables -- no
-- create-new/copy/drop/rename staging-table dance needed here, unlike
-- migrations 0018/0056 (those hit a different, harder problem: dropping a
-- table other tables still hold live FK references to).
--
-- "Location" (tenant_locations) already existed as a separate, complete
-- feature -- a lightweight address/contact sub-record with no scoping role
-- of its own -- and stays that shape; it's just renamed alongside its parent.
--
-- Deliberately NOT touched by this migration: the *_sites targeting tables
-- (policy_sites, component_sites, dashboard_sites, maintenance_policy_sites,
-- patch_policy_sites) keep their table names for now -- renaming those, and
-- the "Add Site flyout" UI pattern built on top of them, is a separate,
-- larger, UI-invasive rename explicitly out of scope here. Their tenant_id
-- COLUMN is renamed to company_id below (a mechanical, non-UI-facing change),
-- but the tables themselves stay "_sites".

ALTER TABLE tenants RENAME TO companies;
ALTER TABLE tenant_contacts RENAME TO company_contacts;
ALTER TABLE tenant_locations RENAME TO company_locations;

ALTER TABLE enrollment_tokens         RENAME COLUMN tenant_id TO company_id;
ALTER TABLE devices                   RENAME COLUMN tenant_id TO company_id;
ALTER TABLE company_contacts          RENAME COLUMN tenant_id TO company_id;
ALTER TABLE company_locations         RENAME COLUMN tenant_id TO company_id;
ALTER TABLE policy_sites              RENAME COLUMN tenant_id TO company_id;
ALTER TABLE sessions                  RENAME COLUMN tenant_id TO company_id;
ALTER TABLE device_audits             RENAME COLUMN tenant_id TO company_id;
ALTER TABLE activity_log              RENAME COLUMN tenant_id TO company_id;
ALTER TABLE device_audit_changes      RENAME COLUMN tenant_id TO company_id;
ALTER TABLE component_sites           RENAME COLUMN tenant_id TO company_id;
ALTER TABLE commands                  RENAME COLUMN tenant_id TO company_id;
ALTER TABLE dashboard_sites           RENAME COLUMN tenant_id TO company_id;
ALTER TABLE maintenance_policy_sites  RENAME COLUMN tenant_id TO company_id;
ALTER TABLE patch_policy_sites        RENAME COLUMN tenant_id TO company_id;

-- jobs.target_type is a free-text column (not a SQL enum) that can hold the
-- literal string 'tenants' as stored DATA, not just a column/identifier name
-- -- a plain schema rename doesn't touch this. Defensive no-op on this
-- project's own data (verified zero rows affected in both local and
-- production before writing this), kept for any other self-hoster's data.
UPDATE jobs SET target_type = 'companies' WHERE target_type = 'tenants';

