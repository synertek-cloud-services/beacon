-- Circuit breaker for flapping alert monitors (issue #169). Scoped to the
-- existing alert_state row (device_id, policy_monitor_id) rather than
-- policy_monitors itself -- policy_monitors is shared across every device a
-- policy targets, so muting there would silently kill notifications for
-- every OTHER device on the same policy too.
--
-- transition_window_started_at / transition_count: a rolling count of
-- notification-worthy transitions (alert.triggered/alert.resolved) within
-- the current window (RATE_LIMIT_WINDOW_SECONDS, worker/src/lib/alerts.ts).
-- Reset to a fresh window once the prior one has fully elapsed.
--
-- notifications_muted_until: set once transition_count exceeds the
-- threshold within a window -- further alert.triggered/resolved
-- notifications for this alert_state row are suppressed (the alert itself
-- keeps tracking normally, still visible on the dashboard) until this
-- timestamp passes. Self-expiring, read live as `> now` -- mirrors
-- devices.fast_poll_until (see lib/fastPoll.ts) -- no cron sweep needed.
ALTER TABLE alert_state ADD COLUMN transition_window_started_at INTEGER;
ALTER TABLE alert_state ADD COLUMN transition_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_state ADD COLUMN notifications_muted_until INTEGER;
