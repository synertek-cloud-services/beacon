CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`enrollment_token_id` text NOT NULL,
	`agent_type` text DEFAULT 'standard' NOT NULL,
	`device_credential_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`hostname` text,
	`os_type` text,
	`os_version` text,
	`detected_class` text,
	`override_class` text,
	`agent_version` text,
	`last_seen` integer,
	`inventory` text,
	`rustdesk_id` text,
	`privacy_mode_override` integer,
	`created_at` integer NOT NULL,
	`approved_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_token_id`) REFERENCES `enrollment_tokens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_device_credential_hash_unique` ON `devices` (`device_credential_hash`);--> statement-breakpoint
CREATE TABLE `enrollment_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`agent_type` text DEFAULT 'standard' NOT NULL,
	`auto_approve` integer,
	`max_uses` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_by` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollment_tokens_token_hash_unique` ON `enrollment_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`auto_approve_default` integer DEFAULT true NOT NULL,
	`privacy_mode_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
