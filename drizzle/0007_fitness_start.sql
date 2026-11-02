CREATE TABLE `fitness_start` (
	`id` integer PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`fitness` real NOT NULL,
	`fatigue` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_backfills` (
	`id` integer PRIMARY KEY NOT NULL,
	`cross_training_from` text,
	`speed_streams` integer DEFAULT false NOT NULL
);
