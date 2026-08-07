-- Hoster-configured Get Support destination URL, delivered to the tray via
-- an unauthenticated GET /v1/branding/identity poll (not the check-in wire
-- protocol -- CLAUDE.md's Network Discovery/Patch Management sections
-- document why check-in extension is deliberately avoided for new
-- functionality; support_url is pure one-way config with no round trip,
-- a worse fit for that channel than any field already there). Nullable:
-- unset means the tray's "Get Support" item stays hidden. Issue #90.
ALTER TABLE branding_identity ADD COLUMN support_url TEXT;
