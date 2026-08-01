-- Drivers opt-in (visibility + manual-approval only, no auto-approval --
-- confirmed via AskUserQuestion). The agent now scans+reports drivers
-- unconditionally (see agent/internal/audit/patches.go) -- this flag
-- gates whether the WORKER keeps driver-type items when storing a
-- device's audit, mirroring the existing privacy-mode software/services
-- stripping precedent already in worker/src/routes/audit.ts, not a new
-- filtering mechanism.
ALTER TABLE patch_policies ADD COLUMN include_drivers INTEGER NOT NULL DEFAULT 0;

-- Microsoft Update (Office & other Microsoft products) opt-in takeover --
-- independent of manage_windows_update (confirmed via AskUserQuestion,
-- matching this codebase's "explicit opt-in per capability, never one
-- blanket flag" convention already established by auto_reboot vs
-- manage_windows_update being separate toggles).
ALTER TABLE patch_policies ADD COLUMN manage_microsoft_update INTEGER NOT NULL DEFAULT 0;

-- Same 1:1 per-device state shape as windows_update_managed/
-- windows_update_prior_state/windows_update_managed_at (migration 0063).
ALTER TABLE devices ADD COLUMN microsoft_update_managed INTEGER;
ALTER TABLE devices ADD COLUMN microsoft_update_prior_state TEXT;
ALTER TABLE devices ADD COLUMN microsoft_update_managed_at INTEGER;
