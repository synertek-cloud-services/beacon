-- Per-monitor opt-in for external notifications (webhook/email), independent
-- of the alert itself firing -- Global Alerts visibility is unconditional
-- (alert_state always gets written), these two gate only whether
-- fireWebhooks/sendAlertEmails run for that specific monitor.
--
-- Defaults to false for all monitors, including existing seeded ones --
-- notifications should only go out when explicitly enabled per monitor,
-- not retroactively for whatever was already in place.
--
-- Note: dashboard/src/pages/PolicyFormPage.vue already had a "Send a
-- Webhook" toggle in its Response section (monPanel.form.sendWebhook) before
-- this migration, but it was a dead local-only stub -- never sent in any
-- monitors.create/update API call and hardcoded back to false on every page
-- load. This migration is what makes it (and its new email counterpart)
-- actually persist and take effect.
ALTER TABLE policy_monitors ADD COLUMN notify_webhook INTEGER NOT NULL DEFAULT 0;
ALTER TABLE policy_monitors ADD COLUMN notify_email   INTEGER NOT NULL DEFAULT 0;
