-- Add priority to alert definitions (critical | high | moderate | low)
ALTER TABLE alert_definitions ADD COLUMN priority TEXT NOT NULL DEFAULT 'high';
