-- Search inside words too. Languages written without spaces between words (Japanese, Chinese,
-- Thai) give the word index of 0001 and 0011 a whole run of text as one word, so only its start
-- was found; and a word inside a compound (German, Dutch) wasn't either. A trigram index of the
-- same text, beside the word index, which stays for terms of one or two letters (too short for
-- trigrams). Its rows share the rowids of the word index's mapping tables, and the triggers that
-- kept the word index keep both now. What is there already is indexed here, once.
CREATE VIRTUAL TABLE `cards_trigram` USING fts5(title, description, tokenize = 'trigram remove_diacritics 1');
--> statement-breakpoint
INSERT INTO cards_trigram (rowid, title, description)
  SELECT m.id, c.title, c.description FROM cards c JOIN cards_fts_map m ON m.entity_id = c.id;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cards_fts_insert`;
--> statement-breakpoint
CREATE TRIGGER `cards_fts_insert` AFTER INSERT ON `cards` BEGIN
  INSERT INTO cards_fts_map (entity_id) VALUES (new.id);
  INSERT INTO cards_fts (rowid, title, description)
    VALUES ((SELECT id FROM cards_fts_map WHERE entity_id = new.id), new.title, new.description);
  INSERT INTO cards_trigram (rowid, title, description)
    VALUES ((SELECT id FROM cards_fts_map WHERE entity_id = new.id), new.title, new.description);
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cards_fts_update`;
--> statement-breakpoint
CREATE TRIGGER `cards_fts_update` AFTER UPDATE OF title, description ON `cards` BEGIN
  UPDATE cards_fts SET title = new.title, description = new.description
    WHERE rowid = (SELECT id FROM cards_fts_map WHERE entity_id = new.id);
  UPDATE cards_trigram SET title = new.title, description = new.description
    WHERE rowid = (SELECT id FROM cards_fts_map WHERE entity_id = new.id);
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cards_fts_delete`;
--> statement-breakpoint
CREATE TRIGGER `cards_fts_delete` AFTER DELETE ON `cards` BEGIN
  DELETE FROM cards_fts WHERE rowid = (SELECT id FROM cards_fts_map WHERE entity_id = old.id);
  DELETE FROM cards_trigram WHERE rowid = (SELECT id FROM cards_fts_map WHERE entity_id = old.id);
  DELETE FROM cards_fts_map WHERE entity_id = old.id;
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `pages_trigram` USING fts5(title, content, tokenize = 'trigram remove_diacritics 1');
--> statement-breakpoint
INSERT INTO pages_trigram (rowid, title, content)
  SELECT m.id, p.title, p.content FROM pages p JOIN pages_fts_map m ON m.entity_id = p.id;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `pages_fts_insert`;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_insert` AFTER INSERT ON `pages` BEGIN
  INSERT INTO pages_fts_map (entity_id) VALUES (new.id);
  INSERT INTO pages_fts (rowid, title, content)
    VALUES ((SELECT id FROM pages_fts_map WHERE entity_id = new.id), new.title, new.content);
  INSERT INTO pages_trigram (rowid, title, content)
    VALUES ((SELECT id FROM pages_fts_map WHERE entity_id = new.id), new.title, new.content);
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `pages_fts_update`;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_update` AFTER UPDATE OF title, content ON `pages` BEGIN
  UPDATE pages_fts SET title = new.title, content = new.content
    WHERE rowid = (SELECT id FROM pages_fts_map WHERE entity_id = new.id);
  UPDATE pages_trigram SET title = new.title, content = new.content
    WHERE rowid = (SELECT id FROM pages_fts_map WHERE entity_id = new.id);
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `pages_fts_delete`;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_delete` AFTER DELETE ON `pages` BEGIN
  DELETE FROM pages_fts WHERE rowid = (SELECT id FROM pages_fts_map WHERE entity_id = old.id);
  DELETE FROM pages_trigram WHERE rowid = (SELECT id FROM pages_fts_map WHERE entity_id = old.id);
  DELETE FROM pages_fts_map WHERE entity_id = old.id;
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `card_comments_trigram` USING fts5(body, tokenize = 'trigram remove_diacritics 1');
--> statement-breakpoint
INSERT INTO card_comments_trigram (rowid, body)
  SELECT m.id, cm.body FROM card_comments cm JOIN card_comments_fts_map m ON m.entity_id = cm.id;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `card_comments_fts_insert`;
--> statement-breakpoint
CREATE TRIGGER `card_comments_fts_insert` AFTER INSERT ON `card_comments` BEGIN
  INSERT INTO card_comments_fts_map (entity_id) VALUES (new.id);
  INSERT INTO card_comments_fts (rowid, body)
    VALUES ((SELECT id FROM card_comments_fts_map WHERE entity_id = new.id), new.body);
  INSERT INTO card_comments_trigram (rowid, body)
    VALUES ((SELECT id FROM card_comments_fts_map WHERE entity_id = new.id), new.body);
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `card_comments_fts_update`;
--> statement-breakpoint
CREATE TRIGGER `card_comments_fts_update` AFTER UPDATE OF body ON `card_comments` BEGIN
  UPDATE card_comments_fts SET body = new.body
    WHERE rowid = (SELECT id FROM card_comments_fts_map WHERE entity_id = new.id);
  UPDATE card_comments_trigram SET body = new.body
    WHERE rowid = (SELECT id FROM card_comments_fts_map WHERE entity_id = new.id);
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `card_comments_fts_delete`;
--> statement-breakpoint
CREATE TRIGGER `card_comments_fts_delete` AFTER DELETE ON `card_comments` BEGIN
  DELETE FROM card_comments_fts WHERE rowid = (SELECT id FROM card_comments_fts_map WHERE entity_id = old.id);
  DELETE FROM card_comments_trigram WHERE rowid = (SELECT id FROM card_comments_fts_map WHERE entity_id = old.id);
  DELETE FROM card_comments_fts_map WHERE entity_id = old.id;
END;
