-- Per-monitor evaluation sampling rate, independent of the sustained-period
-- window. Default 1 preserves today's behavior (evaluate every check-in).
ALTER TABLE policy_monitors ADD COLUMN check_interval_minutes INTEGER NOT NULL DEFAULT 1;
