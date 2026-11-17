CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text,
	`before` text,
	`after` text,
	`meta` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_user_id` text,
	`actor_token_id` text,
	`actor_name` text NOT NULL,
	`batch_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_token_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `history_entity_idx` ON `history` (`entity_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `history_subject_idx` ON `history` (`subject_id`);--> statement-breakpoint
CREATE INDEX `history_user_idx` ON `history` (`actor_user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `history_token_idx` ON `history` (`actor_token_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `history_updated_idx` ON `history` (`updated_at`);--> statement-breakpoint
CREATE INDEX `history_batch_idx` ON `history` (`batch_id`);