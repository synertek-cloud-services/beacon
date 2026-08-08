-- No-op migration. `sessions.session_type` is plain TEXT with no SQL CHECK
-- constraint (confirmed in 0003_lovely_bloodstrike.sql and
-- 0056_device_delete_cascade_fix.sql, the only migrations touching this
-- table) -- adding the new 'screen_share' value (Web Remote, see
-- CLAUDE.md) is a worker/src/db/schema.ts Drizzle-enum-only change,
-- functionally identical to policy_monitors.check_type's documented
-- bare-TEXT convention. This file exists purely so the migration sequence
-- and its own dated audit trail stay consistent with a real, deliberate
-- schema-meaning change, even though there is no DDL to run.
SELECT 1;
