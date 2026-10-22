CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`moving_time` integer NOT NULL,
	`distance` real,
	`paired_event_id` integer,
	`raw` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planned_workouts` (
	`id` integer PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`paired_activity_id` text,
	`raw` text NOT NULL,
	`synced_at` text NOT NULL
);
