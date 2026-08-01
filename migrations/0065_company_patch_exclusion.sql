-- Company-wide opt-out from Patch Policy coverage (and, by extension, from
-- "Manage Windows' own Automatic Updates" takeover, which shares the exact
-- same coverage check) -- for a company that manages Windows Update through
-- its own separate mechanism (WSUS, etc.) and shouldn't have any Beacon
-- Patch Policy forced onto it just because an otherwise-unrestricted global
-- policy targets every device by default. A blanket flag, not a per-policy
-- exclusion list -- see CLAUDE.md's Patch Management section for the scope
-- decision (confirmed via AskUserQuestion).
ALTER TABLE companies ADD COLUMN patch_management_excluded INTEGER NOT NULL DEFAULT 0;
