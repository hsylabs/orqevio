CREATE TABLE `trash` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`contents` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_user_id` text,
	`actor_token_id` text,
	`actor_name` text NOT NULL,
	`deleted_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_token_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `trash_workspace_idx` ON `trash` (`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `trash_expires_idx` ON `trash` (`expires_at`);--> statement-breakpoint
CREATE TABLE `trash_rows` (
	`id` integer PRIMARY KEY NOT NULL,
	`trash_id` text NOT NULL,
	`table_name` text NOT NULL,
	`data` text NOT NULL,
	`storage_key` text,
	FOREIGN KEY (`trash_id`) REFERENCES `trash`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trash_rows_trash_idx` ON `trash_rows` (`trash_id`,`id`);--> statement-breakpoint
CREATE INDEX `trash_rows_storage_idx` ON `trash_rows` (`storage_key`);