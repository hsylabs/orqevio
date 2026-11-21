CREATE TABLE `card_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`card_id` text NOT NULL,
	`body` text NOT NULL,
	`author_kind` text NOT NULL,
	`author_user_id` text,
	`author_token_id` text,
	`author_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`edited_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_token_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `card_comments_card_idx` ON `card_comments` (`card_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `card_comments_token_idx` ON `card_comments` (`author_token_id`);--> statement-breakpoint
-- Full-text search over comments, as for cards and pages (0001_search): each FTS row is linked to
-- its comment through a mapping table whose INTEGER PRIMARY KEY is the FTS rowid.
CREATE TABLE `card_comments_fts_map` (`id` integer PRIMARY KEY, `entity_id` text NOT NULL UNIQUE);
--> statement-breakpoint
CREATE VIRTUAL TABLE `card_comments_fts` USING fts5(body, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `card_comments_fts_insert` AFTER INSERT ON `card_comments` BEGIN
  INSERT INTO card_comments_fts_map (entity_id) VALUES (new.id);
  INSERT INTO card_comments_fts (rowid, body)
    VALUES ((SELECT id FROM card_comments_fts_map WHERE entity_id = new.id), new.body);
END;
--> statement-breakpoint
CREATE TRIGGER `card_comments_fts_update` AFTER UPDATE OF body ON `card_comments` BEGIN
  UPDATE card_comments_fts SET body = new.body
    WHERE rowid = (SELECT id FROM card_comments_fts_map WHERE entity_id = new.id);
END;
--> statement-breakpoint
CREATE TRIGGER `card_comments_fts_delete` AFTER DELETE ON `card_comments` BEGIN
  DELETE FROM card_comments_fts WHERE rowid = (SELECT id FROM card_comments_fts_map WHERE entity_id = old.id);
  DELETE FROM card_comments_fts_map WHERE entity_id = old.id;
END;
