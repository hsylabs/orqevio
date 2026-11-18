ALTER TABLE `vault_items` ADD `key_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vaults` ADD `key_version` integer DEFAULT 0 NOT NULL;