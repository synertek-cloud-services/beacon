-- Removes the Acknowledge feature entirely (added in migration 0027 without
-- any grounding in Datto RMM's real docs, unlike almost every other feature
-- in this codebase). Checked rmm.datto.com directly: alert status is only
-- Open/Resolved -- there is no third "Acknowledged" state in the actual
-- product. An acknowledgment/triage workflow belongs in an external
-- ticketing tool (e.g. Keep), not duplicated inside Beacon itself.
--
-- Any already-acknowledged timestamps are dropped along with the columns --
-- acceptable since the feature they described no longer exists.
ALTER TABLE alert_state DROP COLUMN acknowledged_at;
ALTER TABLE alert_state DROP COLUMN acknowledged_by;
