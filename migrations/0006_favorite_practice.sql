ALTER TABLE rounds ADD COLUMN favorite_only INTEGER NOT NULL DEFAULT 0;
CREATE INDEX rounds_favorites_scope ON rounds(favorite_only,collection,invalidated,id DESC);

DROP TRIGGER practice_added;
DROP TRIGGER practice_membership;
CREATE TRIGGER practice_added AFTER INSERT ON questions WHEN NEW.deleted_at IS NULL BEGIN
  UPDATE rounds SET invalidated=1 WHERE invalidated=0 AND favorite_only=0 AND (collection IS NULL OR collection=NEW.collection);
  UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE answered_at IS NULL AND round_id IN (SELECT id FROM rounds WHERE invalidated=1);
END;
CREATE TRIGGER practice_membership AFTER UPDATE OF collection,deleted_at ON questions
WHEN (OLD.deleted_at IS NULL) != (NEW.deleted_at IS NULL)
  OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL AND OLD.collection != NEW.collection AND EXISTS(SELECT 1 FROM question_sets WHERE name=OLD.collection))
BEGIN
  UPDATE rounds SET invalidated=1 WHERE invalidated=0 AND favorite_only=0 AND (
    (collection IS NULL AND (OLD.deleted_at IS NULL) != (NEW.deleted_at IS NULL))
    OR (collection=OLD.collection AND OLD.deleted_at IS NULL)
    OR (collection=NEW.collection AND NEW.deleted_at IS NULL));
  UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE answered_at IS NULL AND round_id IN (SELECT id FROM rounds WHERE invalidated=1);
END;

CREATE TRIGGER favorite_practice_added AFTER INSERT ON favorites BEGIN
  UPDATE rounds SET invalidated=1 WHERE invalidated=0 AND favorite_only=1;
  UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE answered_at IS NULL AND round_id IN (SELECT id FROM rounds WHERE invalidated=1);
END;

CREATE TRIGGER favorite_practice_removed AFTER DELETE ON favorites BEGIN
  UPDATE rounds SET invalidated=1 WHERE invalidated=0 AND favorite_only=1;
  UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE answered_at IS NULL AND round_id IN (SELECT id FROM rounds WHERE invalidated=1);
END;

CREATE TRIGGER favorite_practice_deleted AFTER UPDATE OF deleted_at ON questions WHEN (OLD.deleted_at IS NULL)!=(NEW.deleted_at IS NULL) AND EXISTS(SELECT 1 FROM favorites WHERE question_id=NEW.id) BEGIN
  UPDATE rounds SET invalidated=1 WHERE favorite_only=1 AND invalidated=0;
  UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE answered_at IS NULL AND round_id IN (SELECT id FROM rounds WHERE invalidated=1);
END;

CREATE TRIGGER favorite_practice_membership AFTER UPDATE OF collection ON questions WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL AND OLD.collection!=NEW.collection AND EXISTS(SELECT 1 FROM question_sets WHERE name=OLD.collection) AND EXISTS(SELECT 1 FROM favorites WHERE question_id=NEW.id) BEGIN
  UPDATE rounds SET invalidated=1 WHERE favorite_only=1 AND invalidated=0 AND (collection=OLD.collection OR collection=NEW.collection);
  UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE answered_at IS NULL AND round_id IN (SELECT id FROM rounds WHERE invalidated=1);
END;
