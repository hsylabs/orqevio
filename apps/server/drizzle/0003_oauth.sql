CREATE TABLE `oauth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`token_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `oauth_codes_expires_idx` ON `oauth_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_id` text NOT NULL,
	`kind` text NOT NULL,
	`expires_at` integer NOT NULL,
	`rotated_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`token_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_tokens_grant_idx` ON `oauth_tokens` (`token_id`);--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `oauth_client_id` text;--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `oauth_redirect_uri` text;