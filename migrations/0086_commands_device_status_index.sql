-- commands has never had an index, despite check-in's "fetch queued
-- commands for this device" query (worker/src/routes/checkin.ts) filtering
-- on exactly (device_id, status) on every single check-in, unconditionally.
-- Confirmed live against production via EXPLAIN QUERY PLAN + a direct
-- rows_read check: that query was reading all 887 rows of commands (a full
-- table scan) to return 0-2 matches, every 60 seconds, per device, forever
-- -- root cause of a real D1 daily rows_read quota alert (issue found
-- 2026-09-17) that had nothing to do with fleet size or user activity: it
-- scales with elapsed time alone, since commands only grows.
CREATE INDEX idx_commands_device_status ON commands(device_id, status);

-- Same missing-index problem, smaller but growing scale: windowsUpdateManagement.ts
-- and microsoftUpdateManagement.ts each filter commands by (type, status) on
-- every 2-minute cron tick to avoid re-dispatching over an outstanding
-- manage/revert command.
CREATE INDEX idx_commands_type_status ON commands(type, status);
