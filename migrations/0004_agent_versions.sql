CREATE TABLE `agent_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`os` text NOT NULL,
	`arch` text NOT NULL,
	`download_url` text NOT NULL,
	`signature_hex` text NOT NULL,
	`published_at` integer NOT NULL,
	`is_latest` integer DEFAULT false NOT NULL
);
