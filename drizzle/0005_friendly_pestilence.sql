CREATE TABLE `sandbox` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`directory` text NOT NULL,
	`branch` text NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_directory_unique` ON `sandbox` (`directory`);--> statement-breakpoint
ALTER TABLE `project` ADD `git_common_dir` text;