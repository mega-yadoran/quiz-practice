ALTER TABLE questions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1));
CREATE INDEX questions_visible_random ON questions(random_key,id) WHERE deleted_at IS NULL AND hidden=0;
CREATE INDEX questions_visible_collection_random ON questions(collection,random_key,id) WHERE deleted_at IS NULL AND hidden=0;

-- Hiding keeps answered history and the current round. Cancel only this question's pending attempts.
CREATE TRIGGER practice_hidden AFTER UPDATE OF hidden ON questions
WHEN OLD.hidden=0 AND NEW.hidden=1 AND NEW.deleted_at IS NULL BEGIN
  UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE question_id=NEW.id AND answered_at IS NULL;
END;
-- Restoring starts fresh rounds so a cancelled/previously answered ID can be selected again.
CREATE TRIGGER practice_restored AFTER UPDATE OF hidden ON questions
WHEN OLD.hidden=1 AND NEW.hidden=0 AND NEW.deleted_at IS NULL BEGIN
  UPDATE rounds SET invalidated=1 WHERE invalidated=0 AND (collection IS NULL OR collection=NEW.collection);
  UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE answered_at IS NULL AND round_id IN (SELECT id FROM rounds WHERE invalidated=1);
END;
