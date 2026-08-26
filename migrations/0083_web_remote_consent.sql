-- End-user remote-access consent for Web Remote (issue #86). Defaults to
-- today's exact existing behavior (no prompt, unchanged) -- nothing changes
-- for any existing company until an admin explicitly opts one in.
ALTER TABLE companies ADD COLUMN remote_access_consent_required INTEGER NOT NULL DEFAULT 0;

-- NULL = inherit the company default above; 0/1 = an explicit per-device
-- override, same nullable-override-over-a-company-default shape as
-- devices.override_class already establishes for detected_class.
ALTER TABLE devices ADD COLUMN remote_access_consent_override INTEGER;

-- Set by the per-session beacon-screenshare.exe helper (POST
-- /v1/sessions/:id/consent, report-token authenticated) before it ever
-- dials the relay, and polled by the dashboard while a screen_share
-- session shows "connecting" -- lets a decline/timeout surface immediately
-- instead of waiting out the generic 70s connect timeout. NULL means no
-- consent decision has been reported (consent wasn't required for this
-- session, or the helper hasn't reported yet).
ALTER TABLE sessions ADD COLUMN consent_status TEXT;
