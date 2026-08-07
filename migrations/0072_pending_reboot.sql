-- Fleet-visible pending-reboot state, set when an install_patches command
-- reports reboot_required and cleared once a subsequent check-in's
-- uptime_seconds shows the device has since restarted (worker/src/routes/
-- checkin.ts). Unlike windows_update_managed/is_hyper_v_host this has no
-- meaningful "never evaluated" tri-state -- a device either has a pending
-- reboot or it doesn't -- so it's a real default-false boolean, not
-- nullable. See CLAUDE.md's Patch Management section for the full design
-- (issue #89).
ALTER TABLE devices ADD COLUMN pending_reboot_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN pending_reboot_detected_at INTEGER;
