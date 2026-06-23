-- Open GitHub PRs authored by the user, refreshed each sweep (~3x/day) by a
-- deterministic server step (server/github-prs.ts) — NOT edition-scoped. The
-- whole table is replaced on every successful refresh, so closed/merged PRs
-- drop out automatically and the PRs tab always shows the current set.
CREATE TABLE IF NOT EXISTS github_prs (
  repo             TEXT    NOT NULL,
  number           INTEGER NOT NULL,
  title            TEXT    NOT NULL,
  url              TEXT    NOT NULL,
  is_draft         INTEGER NOT NULL DEFAULT 0,
  state_label      TEXT    NOT NULL,            -- "Ready" | "Draft"
  review_decision  TEXT,                        -- REVIEW_REQUIRED | APPROVED | CHANGES_REQUESTED | ''
  merge_state      TEXT,                        -- mergeStateStatus: BEHIND | DIRTY | BLOCKED | CLEAN | ...
  mergeable        TEXT,                         -- MERGEABLE | CONFLICTING | UNKNOWN
  ci               TEXT    NOT NULL DEFAULT 'none', -- pass | fail | pending | none
  flags            TEXT    NOT NULL DEFAULT '[]',   -- JSON array of short flag strings
  review_channel   TEXT,                        -- inferred Slack channel
  channel_verified INTEGER NOT NULL DEFAULT 1,  -- 0 = inferred (no CODEOWNERS), show "verify"
  tickets          TEXT    NOT NULL DEFAULT '[]',   -- JSON array, e.g. ["AB-4962"]
  blocked_by       TEXT    NOT NULL DEFAULT '[]',   -- JSON array, e.g. ["#21755"]
  note             TEXT    NOT NULL DEFAULT '',  -- derived "why open beyond review"
  created_at       TEXT    NOT NULL,            -- PR createdAt (ISO 8601)
  fetched_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (repo, number)
);
