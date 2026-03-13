CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`metadata` text,
	`ordinal` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_session_id_idx` ON `message` (`session_id`);--> statement-breakpoint
CREATE INDEX `message_session_ordinal_idx` ON `message` (`session_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `part` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`type` text NOT NULL,
	`ordinal` integer NOT NULL,
	`data` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `part_message_ordinal_idx` ON `part` (`message_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `part_session_id_idx` ON `part` (`session_id`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`directory` text NOT NULL,
	`worktree` text,
	`vcs` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_directory_unique` ON `project` (`directory`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`title` text,
	`permission` text,
	`compacted_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_project_id_idx` ON `session` (`project_id`);