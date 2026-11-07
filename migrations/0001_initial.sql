PRAGMA foreign_keys = ON;

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  answer TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  reading TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  random_key REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX questions_random ON questions(random_key, id);

CREATE TABLE favorites (
  question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_key REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  question_text TEXT NOT NULL,
  reading TEXT NOT NULL,
  answer TEXT NOT NULL,
  aliases TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT NOT NULL,
  source TEXT NOT NULL,
  submitted_answer TEXT,
  correct INTEGER,
  overridden INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  answered_at TEXT,
  UNIQUE(round_id, question_id)
);
CREATE INDEX attempts_round ON attempts(round_id, issued_at);
CREATE INDEX attempts_history ON attempts(answered_at DESC);
CREATE UNIQUE INDEX attempts_one_pending ON attempts(round_id) WHERE answered_at IS NULL;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  rate REAL NOT NULL DEFAULT 1,
  show_question INTEGER NOT NULL DEFAULT 0
);
INSERT INTO settings(id) VALUES(1);
