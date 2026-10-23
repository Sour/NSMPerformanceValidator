ALTER TABLE `activities` ADD `intervals` text;
--> statement-breakpoint
-- Re-fetch everything since the [NSM] start once, so earlier Quality Runs get their detected intervals.
UPDATE `sync_status` SET `synced_through` = NULL;
