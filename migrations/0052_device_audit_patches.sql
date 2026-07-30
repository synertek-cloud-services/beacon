-- Pending/missing Windows Update patches from the agent's most recent audit
-- (Windows-only -- no Linux/macOS collector, matching Datto RMM's own Patch
-- Management scope). Scan+report only for this v1 slice: no approval state,
-- no install status, no scheduling. See agent/internal/audit/patches.go and
-- worker/src/routes/audit.ts.
ALTER TABLE device_audits ADD COLUMN patches TEXT;
