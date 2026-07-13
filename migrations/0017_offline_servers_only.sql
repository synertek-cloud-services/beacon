-- Narrow the seeded "Device Offline" global policy to servers only.
-- Workstations/laptops routinely go offline overnight (shutdown, sleep, lid
-- close) — a 30-minute silence threshold on those classes fires constantly
-- on completely normal behavior. Servers are expected to be always-on, so
-- the same threshold there is a real signal. User's explicit call: no
-- offline monitoring at all for workstation/laptop by default.
UPDATE policies
SET target_class = '["server"]', updated_at = unixepoch()
WHERE id = 'policy-offline';
