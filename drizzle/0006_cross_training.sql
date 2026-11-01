CREATE TABLE `cross_training` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`moving_time` integer NOT NULL,
	`raw` text NOT NULL,
	`streams` text,
	`synced_at` text NOT NULL
);
