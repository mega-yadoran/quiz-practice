ALTER TABLE rounds ADD COLUMN collection TEXT DEFAULT NULL;
ALTER TABLE rounds ADD COLUMN invalidated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rounds ADD COLUMN number INTEGER NOT NULL DEFAULT 1;
UPDATE rounds SET number=id;
ALTER TABLE settings ADD COLUMN last_practice_round INTEGER REFERENCES rounds(id);
UPDATE settings SET last_practice_round=(SELECT MAX(id) FROM rounds);
CREATE INDEX rounds_scope ON rounds(collection,invalidated,id DESC);

-- Keep completed history; only pending questions in invalidated rounds are cancelled.
CREATE TRIGGER practice_added AFTER INSERT ON questions WHEN NEW.deleted_at IS NULL BEGIN
  UPDATE rounds SET invalidated=1 WHERE invalidated=0 AND (collection IS NULL OR collection=NEW.collection);
  UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE answered_at IS NULL AND round_id IN (SELECT id FROM rounds WHERE invalidated=1);
END;
CREATE TRIGGER practice_membership AFTER UPDATE OF collection,deleted_at ON questions
WHEN (OLD.deleted_at IS NULL) != (NEW.deleted_at IS NULL)
  OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL AND OLD.collection != NEW.collection AND EXISTS(SELECT 1 FROM question_sets WHERE name=OLD.collection))
BEGIN
  UPDATE rounds SET invalidated=1 WHERE invalidated=0 AND (
    (collection IS NULL AND (OLD.deleted_at IS NULL) != (NEW.deleted_at IS NULL))
    OR (collection=OLD.collection AND OLD.deleted_at IS NULL)
    OR (collection=NEW.collection AND NEW.deleted_at IS NULL));
  UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE answered_at IS NULL AND round_id IN (SELECT id FROM rounds WHERE invalidated=1);
END;
