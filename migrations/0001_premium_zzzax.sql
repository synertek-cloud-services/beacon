CREATE TABLE `commands` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
