-- Keep question IDs as history references; deleted questions are excluded from active use.
ALTER TABLE questions ADD COLUMN deleted_at TEXT;
ALTER TABLE attempts ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0;
CREATE INDEX questions_active_random ON questions(random_key, id) WHERE deleted_at IS NULL;
CREATE INDEX questions_active_collection ON questions(collection, id) WHERE deleted_at IS NULL;
