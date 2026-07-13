-- Migrate the seeded Disk Space monitor's config to the multi-drive shape:
-- { drive, threshold_type, threshold_value, min_disk_gb } replaces bytes_free_min.
UPDATE policy_monitors
SET config = '{"drive":"any","threshold_type":"gb_free","threshold_value":10,"min_disk_gb":null}'
WHERE id = 'pm-disk-space';
