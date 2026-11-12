-- Full-text search over card and page titles and bodies.
-- unicode61 with remove_diacritics makes "cancion" match "Canción" and ignores case.
-- Each index row keeps the entity id (not SQLite's rowid, which VACUUM may renumber)
-- and triggers keep the indexes in sync with their tables.
CREATE VIRTUAL TABLE `cards_fts` USING fts5(entity_id UNINDEXED, title, description, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `cards_fts_insert` AFTER INSERT ON `cards` BEGIN
  INSERT INTO cards_fts (entity_id, title, description) VALUES (new.id, new.title, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER `cards_fts_update` AFTER UPDATE OF title, description ON `cards` BEGIN
  DELETE FROM cards_fts WHERE entity_id = old.id;
  INSERT INTO cards_fts (entity_id, title, description) VALUES (new.id, new.title, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER `cards_fts_delete` AFTER DELETE ON `cards` BEGIN
  DELETE FROM cards_fts WHERE entity_id = old.id;
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `pages_fts` USING fts5(entity_id UNINDEXED, title, content, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `pages_fts_insert` AFTER INSERT ON `pages` BEGIN
  INSERT INTO pages_fts (entity_id, title, content) VALUES (new.id, new.title, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_update` AFTER UPDATE OF title, content ON `pages` BEGIN
  DELETE FROM pages_fts WHERE entity_id = old.id;
  INSERT INTO pages_fts (entity_id, title, content) VALUES (new.id, new.title, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_delete` AFTER DELETE ON `pages` BEGIN
  DELETE FROM pages_fts WHERE entity_id = old.id;
END;
