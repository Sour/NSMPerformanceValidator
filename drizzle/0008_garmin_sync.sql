CREATE TABLE `garmin_sync` (
	`id` integer PRIMARY KEY NOT NULL,
	`failure` text,
	`failing_since` text,
	`changed_at` text,
	`lthr_from` real,
	`lthr_to` real,
	`max_hr_from` real,
	`max_hr_to` real
);
