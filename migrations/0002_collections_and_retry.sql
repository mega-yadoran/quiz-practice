CREATE TABLE question_sets (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO question_sets(name) VALUES('');
ALTER TABLE questions ADD COLUMN collection TEXT NOT NULL DEFAULT '';
ALTER TABLE questions ADD COLUMN majorCategory TEXT NOT NULL DEFAULT '';
ALTER TABLE questions ADD COLUMN minorCategory TEXT NOT NULL DEFAULT '';
ALTER TABLE questions ADD COLUMN retryAliases TEXT NOT NULL DEFAULT '[]';
CREATE INDEX questions_collection ON questions(collection, id);
ALTER TABLE attempts ADD COLUMN collection TEXT NOT NULL DEFAULT '';
ALTER TABLE attempts ADD COLUMN majorCategory TEXT NOT NULL DEFAULT '';
ALTER TABLE attempts ADD COLUMN minorCategory TEXT NOT NULL DEFAULT '';
ALTER TABLE attempts ADD COLUMN retryAliases TEXT NOT NULL DEFAULT '[]';
ALTER TABLE attempts ADD COLUMN retry_requested INTEGER NOT NULL DEFAULT 0;
