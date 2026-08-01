-- Device Class targeting for Patch Policy (workstation/laptop/server),
-- ANDed with the existing Company/Device/Group OR-list targeting -- mirrors
-- policies.targetClass exactly (same JSON-array-in-TEXT convention, same
-- default meaning "all classes"). No OS dimension: Patch Management only
-- ever runs against Windows devices in the first place, so an OS filter
-- here would be permanently inert.
ALTER TABLE patch_policies ADD COLUMN target_class TEXT NOT NULL DEFAULT '["server","workstation","laptop"]';
