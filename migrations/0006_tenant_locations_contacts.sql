CREATE TABLE `tenant_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
	`name` text NOT NULL,
	`is_primary` integer NOT NULL DEFAULT false,
	`street` text,
	`city` text,
	`state` text,
	`zip` text,
	`country` text,
	`created_at` integer NOT NULL
);

CREATE TABLE `tenant_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
	`name` text NOT NULL,
	`title` text,
	`email` text,
	`phone` text,
	`is_primary` integer NOT NULL DEFAULT false,
	`created_at` integer NOT NULL
);

-- Migrate existing flat address data into tenant_locations
INSERT INTO `tenant_locations` (id, tenant_id, name, is_primary, street, city, state, zip, country, created_at)
SELECT
	lower(hex(randomblob(16))),
	id,
	'Primary Location',
	1,
	json_extract(address, '$.street'),
	json_extract(address, '$.city'),
	json_extract(address, '$.state'),
	json_extract(address, '$.zip'),
	json_extract(address, '$.country'),
	created_at
FROM tenants
WHERE address IS NOT NULL;

-- Migrate existing flat contact data into tenant_contacts
INSERT INTO `tenant_contacts` (id, tenant_id, name, title, email, phone, is_primary, created_at)
SELECT
	lower(hex(randomblob(16))),
	id,
	contact_name,
	NULL,
	contact_email,
	contact_phone,
	1,
	created_at
FROM tenants
WHERE contact_name IS NOT NULL;
