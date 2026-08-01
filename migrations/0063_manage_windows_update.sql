-- Patch Policy can optionally take over Windows' own separate "Automatic
-- Updates" behavior (the AU Group Policy registry keys), so it can't sneak
-- in an unapproved update or reboot outside a configured install window --
-- opt-in per policy, gated strictly on real Patch Policy coverage so a
-- device is never left with Windows Update disabled and nothing else to
-- patch it. See worker/src/lib/windowsUpdateManagement.ts.
ALTER TABLE patch_policies ADD COLUMN manage_windows_update INTEGER NOT NULL DEFAULT 0;

-- Per-device tracked state. windows_update_managed is nullable: NULL means
-- never evaluated (e.g. non-Windows, or not yet audited/covered).
-- windows_update_prior_state is a JSON snapshot of what the AU registry
-- values were immediately before Beacon's first takeover -- used to revert
-- to the device's real prior configuration, not a guessed default.
ALTER TABLE devices ADD COLUMN windows_update_managed INTEGER;
ALTER TABLE devices ADD COLUMN windows_update_prior_state TEXT;
ALTER TABLE devices ADD COLUMN windows_update_managed_at INTEGER;
