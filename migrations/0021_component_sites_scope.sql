-- Per-component "Sites" scoping (mirrors policies.scope/company_id) — a
-- component is either global (visible/usable everywhere) or restricted to a
-- single company, matching this codebase's existing single-company-scope
-- convention rather than a many-to-many sites table.
ALTER TABLE components ADD COLUMN scope TEXT NOT NULL DEFAULT 'global'; -- 'global' | 'company'
ALTER TABLE components ADD COLUMN company_id TEXT REFERENCES tenants(id);
