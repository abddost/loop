ALTER TABLE `session` ADD `parent_id` text;--> statement-breakpoint
CREATE INDEX `session_parent_id_idx` ON `session` (`parent_id`);