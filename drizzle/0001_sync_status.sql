CREATE TABLE `sync_status` (
	`id` integer PRIMARY KEY NOT NULL,
	`finished_at` text NOT NULL,
	`error` text,
	`succeeded_at` text,
	`synced_through` text
);
