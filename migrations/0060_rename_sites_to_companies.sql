-- Follow-on to 0059 (Tenant -> Company rename): the many-to-many *targeting*
-- tables and the "Add Site flyout" UI pattern built on them were deliberately
-- left unrenamed there -- a separate, larger, UI-invasive rename, not bundled
-- into that PR. This is that follow-on. ALTER TABLE RENAME TO / RENAME COLUMN
-- both already verified working cleanly on D1 (0059's own investigation),
-- including correctly rewriting dependent FK REFERENCES clauses.

ALTER TABLE policy_sites             RENAME TO policy_companies;
ALTER TABLE component_sites          RENAME TO component_companies;
ALTER TABLE dashboard_sites          RENAME TO dashboard_companies;
ALTER TABLE maintenance_policy_sites RENAME TO maintenance_policy_companies;
ALTER TABLE patch_policy_sites       RENAME TO patch_policy_companies;
