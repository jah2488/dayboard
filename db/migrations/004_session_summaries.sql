-- Cached LLM-enriched summaries for Claude Code sessions (the Sessions tab).
-- The Sessions list/detail are computed live from ~/.claude/projects transcripts;
-- only the optional "Summarize with Claude" prose is persisted, keyed by session id.
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY,
  goal       TEXT NOT NULL,
  outcome    TEXT NOT NULL,
  model      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
