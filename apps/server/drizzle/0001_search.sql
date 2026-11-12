-- Full-text search over card and page titles and bodies.
-- unicode61 with remove_diacritics makes "cancion" match "Canción" and ignores case.
--
-- Each FTS row is linked to its card or page through a small mapping table whose
-- INTEGER PRIMARY KEY is the FTS rowid: lookups by entity id use an index (no
-- full scans when saving or deleting), and the link survives VACUUM, which may
-- renumber the implicit rowids of tables with text primary keys.
CREATE TABLE `cards_fts_map` (`id` integer PRIMARY KEY, `entity_id` text NOT NULL UNIQUE);
--> statement-breakpoint
CREATE VIRTUAL TABLE `cards_fts` USING fts5(title, description, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `cards_fts_insert` AFTER INSERT ON `cards` BEGIN
  INSERT INTO cards_fts_map (entity_id) VALUES (new.id);
  INSERT INTO cards_fts (rowid, title, description)
    VALUES ((SELECT id FROM cards_fts_map WHERE entity_id = new.id), new.title, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER `cards_fts_update` AFTER UPDATE OF title, description ON `cards` BEGIN
  UPDATE cards_fts SET title = new.title, description = new.description
    WHERE rowid = (SELECT id FROM cards_fts_map WHERE entity_id = new.id);
END;
--> statement-breakpoint
CREATE TRIGGER `cards_fts_delete` AFTER DELETE ON `cards` BEGIN
  DELETE FROM cards_fts WHERE rowid = (SELECT id FROM cards_fts_map WHERE entity_id = old.id);
  DELETE FROM cards_fts_map WHERE entity_id = old.id;
END;
--> statement-breakpoint
CREATE TABLE `pages_fts_map` (`id` integer PRIMARY KEY, `entity_id` text NOT NULL UNIQUE);
--> statement-breakpoint
CREATE VIRTUAL TABLE `pages_fts` USING fts5(title, content, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `pages_fts_insert` AFTER INSERT ON `pages` BEGIN
  INSERT INTO pages_fts_map (entity_id) VALUES (new.id);
  INSERT INTO pages_fts (rowid, title, content)
    VALUES ((SELECT id FROM pages_fts_map WHERE entity_id = new.id), new.title, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_update` AFTER UPDATE OF title, content ON `pages` BEGIN
  UPDATE pages_fts SET title = new.title, content = new.content
    WHERE rowid = (SELECT id FROM pages_fts_map WHERE entity_id = new.id);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_delete` AFTER DELETE ON `pages` BEGIN
  DELETE FROM pages_fts WHERE rowid = (SELECT id FROM pages_fts_map WHERE entity_id = old.id);
  DELETE FROM pages_fts_map WHERE entity_id = old.id;
END;
