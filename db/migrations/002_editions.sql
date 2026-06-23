-- A day can have multiple "editions" (pages): the morning brief plus any
-- mid-day re-sweep ("reset"). Sections belong to an edition; the original is
-- always retained. Tasks stay global (not duplicated per edition).

CREATE TABLE IF NOT EXISTS editions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL REFERENCES days(date),
  label      TEXT NOT NULL,                  -- e.g. "Morning", "Reset 1:34 PM"
  trigger    TEXT NOT NULL DEFAULT 'manual', -- morning|manual|seed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_editions_date ON editions(date);

ALTER TABLE sections ADD COLUMN edition_id INTEGER REFERENCES editions(id);
CREATE INDEX IF NOT EXISTS idx_sections_edition ON sections(edition_id);
