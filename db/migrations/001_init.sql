-- dayboard schema (SQLite). One row per day; sections are dismissable triage
-- cards; tasks carry over across days until completed/deleted.

CREATE TABLE IF NOT EXISTS days (
  date             TEXT PRIMARY KEY,           -- YYYY-MM-DD (local)
  greeting         TEXT,
  first_meeting_at TEXT,                        -- ISO 8601
  meeting_count    INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL REFERENCES days(date),
  source       TEXT NOT NULL,                   -- slack|github|notion|linear|email|calendar|partner-tracker|morning-brief
  title        TEXT NOT NULL,
  body_md      TEXT NOT NULL DEFAULT '',
  sort         INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active',  -- active|done|hidden
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sections_date ON sections(date);

CREATE TABLE IF NOT EXISTS tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'backlog', -- current|backlog|done|deleted
  is_current        INTEGER NOT NULL DEFAULT 0,
  source_section_id INTEGER REFERENCES sections(id),
  source_date       TEXT,
  due_date          TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Raw routine runs, for audit + reprocessing.
CREATE TABLE IF NOT EXISTS ingest_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  date        TEXT NOT NULL,
  raw_json    TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generic event log (Phase 4: trends / upcoming warnings).
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,
  date         TEXT NOT NULL,
  payload_json TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
