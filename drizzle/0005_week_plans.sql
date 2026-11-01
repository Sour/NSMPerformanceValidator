CREATE TABLE `plan_suggestion_dismissals` (
	`week` text NOT NULL,
	`suggestion_id` text NOT NULL,
	PRIMARY KEY(`week`, `suggestion_id`)
);
--> statement-breakpoint
CREATE TABLE `planner_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`easy_hr_low` real,
	`easy_hr_high` real,
	`quality_share_target` integer
);
--> statement-breakpoint
CREATE TABLE `week_plans` (
	`week` text PRIMARY KEY NOT NULL,
	`days` text NOT NULL,
	`pushed` text NOT NULL,
	`pushed_at` text,
	`changed_on_intervals` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `athlete_settings` ADD `lthr` real;