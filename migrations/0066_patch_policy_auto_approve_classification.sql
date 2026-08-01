-- Auto-Approval switches from an MSRC severity threshold to Windows
-- Update's own real Classification taxonomy (Critical Updates, Security
-- Updates, Update Rollups, Feature Packs, Service Packs, Tools, Updates).
-- MSRC severity is only meaningfully populated for Security-Updates-
-- classified patches -- everything else (Update Rollups, Feature Packs,
-- Service Packs, Tools, the separate "Critical Updates" classification)
-- came back "Unspecified" and could never auto-approve under any severity
-- threshold, including the most permissive one. Confirmed via
-- AskUserQuestion: replace, not layer alongside.
ALTER TABLE patch_policies DROP COLUMN min_severity;
ALTER TABLE patch_policies ADD COLUMN auto_approve_classifications TEXT NOT NULL DEFAULT '[]';
