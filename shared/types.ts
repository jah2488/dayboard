// Shared domain types used by both the server and the React UI.

export type SectionSource =
  | "slack"
  | "github"
  | "notion"
  | "linear"
  | "datadog"
  | "email"
  | "calendar"
  | "claude-sessions"
  | "learnings"
  | "partner-tracker"
  | "morning-brief";

export type SectionStatus = "active" | "done" | "hidden";
export type TaskStatus = "current" | "backlog" | "done" | "deleted";

export interface Day {
  date: string; // YYYY-MM-DD
  greeting: string | null;
  firstMeetingAt: string | null; // ISO
  meetingCount: number | null;
  createdAt: string;
}

export type EditionTrigger = "morning" | "manual" | "seed";

export interface SweepIssue {
  source: string; // routine or connector, e.g. "GitHub", "Calendar"
  message: string;
}

export interface Edition {
  id: number;
  date: string;
  label: string;
  trigger: EditionTrigger;
  createdAt: string;
  issues: SweepIssue[];
}

export interface Section {
  id: number;
  editionId: number;
  date: string;
  source: SectionSource;
  title: string;
  bodyMd: string;
  sort: number;
  status: SectionStatus;
  createdAt: string;
  dismissedAt: string | null;
}

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  status: TaskStatus;
  isCurrent: boolean;
  sourceSectionId: number | null;
  sourceDate: string | null;
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ---- open GitHub PRs (the PRs tab) ----
// Deterministically fetched via the `gh` CLI each sweep; the whole set is
// replaced on every refresh. `ageDays` is computed at read time so it stays
// accurate between sweeps.
export type PrCi = "pass" | "fail" | "pending" | "none";

export interface OpenPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  stateLabel: string; // "Ready" | "Draft"
  reviewDecision: string | null;
  mergeState: string | null;
  mergeable: string | null;
  ci: PrCi;
  flags: string[]; // short status flags, e.g. ["behind", "failing CI"]
  reviewChannel: string | null;
  channelVerified: boolean; // false = inferred (repo has no CODEOWNERS)
  tickets: string[]; // e.g. ["AB-4962"]
  blockedBy: string[]; // e.g. ["#21755"]
  note: string; // derived "why still open beyond review"
  createdAt: string; // ISO
  ageDays: number;
  fetchedAt: string;
}

// Contract shared by the inbox files and POST /api/ingest.
export interface IngestPayload {
  date: string; // YYYY-MM-DD
  calendar?: { firstMeetingAt: string | null; meetingCount: number };
  sections: Array<{
    source: SectionSource;
    title: string;
    bodyMd: string;
    sort?: number;
  }>;
}

// Reference docs from ~/Projects/learnings.
export interface LearningDoc {
  file: string; // e.g. 2026-06-03-foo.md
  title: string; // first H1, or humanized slug
  date: string | null; // YYYY-MM-DD parsed from filename
  slug: string;
  mtime: number;
}
export interface LearningContent extends Omit<LearningDoc, "mtime"> {
  content: string; // raw markdown
}

// ---- Claude Code sessions (the Sessions tab) ----
// Derived from the local Claude Code transcripts under ~/.claude/projects.
// All stats are parsed deterministically from the JSONL; the goal/outcome
// summary is optionally enriched by an on-demand LLM pass (cached in SQLite).

export interface SessionWebUse {
  searches: number; // WebSearch tool calls + server-side web_search_requests
  fetches: number; // WebFetch tool calls + server-side web_fetch_requests
}

export interface SessionTokens {
  contextHighWater: number; // peak (input + cache read + cache creation) on one turn
  totalOutput: number; // output tokens summed across the session
  totalInput: number; // raw input tokens summed (excludes cache)
}

export interface SessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: { total: number; byName: Array<{ name: string; count: number }> };
  web: SessionWebUse;
  tokens: SessionTokens;
  models: string[];
  durationMs: number | null;
  startedAt: string | null; // ISO; first event timestamp
  endedAt: string | null; // ISO; last event timestamp
}

export interface SessionPr {
  number: number;
  url: string;
  repository: string; // e.g. "acme/web-app"
}

export interface SessionLearningLink {
  file: string; // matches a LearningDoc.file, when the doc still exists
  title: string | null;
}

// LLM-enriched summary, generated on demand and cached.
export interface SessionSummaryCache {
  goal: string;
  outcome: string;
  model: string | null;
  createdAt: string;
}

// "direct" = the user typed it (interactive CLI / desktop). "agent" = launched
// programmatically (headless `claude -p` via the SDK) — workflow subagents,
// the brain's own sweep/verify/synthesis runs, the morning brief. Derived from
// the transcript's entrypoint, so AI-to-AI chatter can be told from real work.
export type SessionOrigin = "agent" | "direct";

// The Sessions tab buckets the same three ways the usage charts do, so the
// list can default to "Mine" and filter out the agent/sweep flood. A sweep is
// a dashboard routine run; interactive is one the user started; agent is any
// other headless run (workflow subagents, the on-demand summarizer).
export type SessionCategory = "interactive" | "agent" | "sweep";

export interface SessionListItem {
  id: string; // session uuid (transcript filename)
  project: string; // repo dir under ~/Projects, derived from cwd
  cwd: string | null;
  title: string; // Claude's auto ai-title, or a fallback
  goalPreview: string; // first user prompt, truncated
  startedAt: string | null; // ISO
  endedAt: string | null; // ISO
  mtime: number;
  running: boolean; // a live interactive CLI session right now
  origin: SessionOrigin;
  category: SessionCategory;
  tags: string[]; // brain topic labels for this session ([] until indexed/tagged)
  stats: SessionStats;
  prCount: number;
  learningCount: number;
}

export interface SessionTurn {
  role: "user" | "assistant";
  text: string;
  ts: string | null;
  toolCalls: Array<{ name: string; detail: string }>;
}

export interface SessionDetail extends SessionListItem {
  gitBranch: string | null;
  goal: string; // full first user prompt
  results: string; // last assistant text block
  prs: SessionPr[];
  learnings: SessionLearningLink[];
  turns: SessionTurn[];
  summary: SessionSummaryCache | null;
}

export interface HealthResponse {
  ok: boolean;
  date: string;
  tables: string[];
}

// Full payload for rendering one day. A day has one or more editions (pages);
// `sections` are for the selected edition (defaults to the newest). Open tasks
// (current + backlog) are the live working set shown on every day/edition;
// doneToday is scoped to the viewed date.
export interface DayView {
  date: string;
  day: Day | null;
  editions: Edition[]; // newest first
  selectedEditionId: number | null;
  // Non-null while a sweep is running for this date — lets any page load (not
  // just the tab that launched it) show progress and poll until it settles.
  activeSweep: SweepJob | null;
  sections: Section[];
  tasks: {
    current: Task | null;
    backlog: Task[];
    doneToday: Task[];
  };
}

// Phase 4: trends + upcoming.
export interface Insights {
  date: string;
  upcoming: {
    overdue: Task[];
    dueToday: Task[];
    dueSoon: Task[]; // within the next 3 days
  };
  stale: Array<{ task: Task; ageDays: number }>; // open >= 3 days
  weekly: Array<{ date: string; created: number; completed: number }>; // last 7 days, oldest first
  totals: { open: number; completedThisWeek: number };
}

// ---- token / session usage (the Trends tab usage charts) ----
// Derived live from the same transcript parse-cache the Sessions tab uses.
// Tokens are split three ways so the real cost driver is visible:
//   - interactive: sessions the user started themselves (origin "direct")
//   - agent: other headless `claude -p` runs (workflow subagents, the on-demand
//     summarizer) that are NOT a dashboard routine
//   - sweep: the dashboard's own automated routines (brain sweep, morning
//     brief, partner snapshot)
// Tokens are input + output summed (cache reads excluded — not surfaced by the
// parser and they'd swamp the comparison).
export type UsageRange = "week" | "month" | "all";

export interface UsageBucket {
  start: string; // ISO start of the time bucket (local boundary)
  interactiveTokens: number;
  agentTokens: number;
  sweepTokens: number;
}

export interface UsageDayCount {
  date: string; // YYYY-MM-DD (local)
  sessions: number; // interactive sessions started that day
}

export interface UsageTopic {
  slug: string;
  label: string;
  docs: number; // indexed docs (sessions + learnings) touching this topic in-window
}

export interface Usage {
  range: UsageRange;
  bucketHours: number; // bucket granularity actually used: 6 (week) | 24 (month) | 168 (all)
  buckets: UsageBucket[];
  sessionsPerDay: UsageDayCount[]; // interactive sessions only
  topTopics: UsageTopic[]; // top 3 by in-window doc count
  totals: {
    totalTokens: number;
    interactiveTokens: number;
    agentTokens: number;
    sweepTokens: number;
    sweepShare: number; // sweep / total, 0..1
    sessions: number; // interactive sessions in-window (the human-meaningful count)
    agentRuns: number; // headless runs in-window (sweep + other agent), for context
  };
}

export type SweepStatus = "running" | "done" | "error";

// ---- Brain (the mindmap tab) ----
// Documents = learnings + Claude sessions. A daily "brain sweep" asks Claude to
// extract topics and cross-document links; the results live as one connections
// JSON file per document under data/brain/connections/ (the source of truth —
// no DB tables), plus a topic registry in data/brain/topics.json. The server
// aggregates those files into a BrainGraph on demand.

export type BrainDocKind = "learning" | "session";

// "artifact" links are derived deterministically from existing data (e.g. a
// session wrote a learning doc); "ai" links come from the sweep's judgment.
export type BrainLinkOrigin = "ai" | "artifact";

export interface BrainTopicRef {
  slug: string;
  strength: number; // 0..1 — how central the topic is to the doc
  excerpt: string | null; // short verbatim quote of the part about this topic
}

export interface BrainLink {
  id: string; // BrainConnections.id of the other document
  reason: string;
  origin: BrainLinkOrigin;
}

export interface BrainTopic {
  slug: string; // kebab-case canonical key, e.g. "project-alpha"
  label: string; // display name, e.g. "Project Alpha"
  description: string; // one-line gist, set when the topic is first coined
  // A Claude-written paragraph synthesizing the key findings and connections
  // across every document in this topic — refreshed by the sweep whenever the
  // topic's membership changes. Empty until first generated.
  summary: string;
  // Signature of the member set the summary was written from (sorted doc ids +
  // their indexedAt); when it drifts, the sweep re-summarizes. Internal — the
  // UI ignores it.
  summaryFingerprint: string;
}

// One per indexed document: data/brain/connections/<kind>--<key>.json
export interface BrainConnections {
  id: string; // "learning:<file>" | "session:<sessionId>"
  kind: BrainDocKind;
  title: string;
  date: string | null; // YYYY-MM-DD of the source doc, when known
  summary: string; // one-or-two sentence gist written by the sweep
  origin: SessionOrigin; // learnings are always "direct"; sessions vary
  topics: BrainTopicRef[];
  linksTo: BrainLink[];
  linkedFrom: BrainLink[]; // mirror of other docs' linksTo, kept in sync by the sweep
  sourceMtime: number; // mtime of the source doc when indexed — drives re-indexing
  indexedAt: string; // ISO
}

export interface BrainGraphDoc {
  id: string;
  kind: BrainDocKind;
  title: string;
  summary: string;
  date: string | null; // YYYY-MM-DD when known
  origin: SessionOrigin; // agent-origin sessions render distinctly in the map
  topics: BrainTopicRef[];
  missing: boolean; // indexed, but the source doc no longer exists
}

// Hidden ids are kept out of the default graph view but never deleted — a
// "Show hidden" toggle brings them back, ghosted. data/brain/hidden.json.
export interface BrainHidden {
  docs: string[]; // doc ids
  topics: string[]; // topic slugs
}

export interface BrainGraph {
  docs: BrainGraphDoc[];
  topics: Array<BrainTopic & { docCount: number }>;
  links: Array<{
    from: string;
    to: string;
    reason: string;
    origin: BrainLinkOrigin;
  }>;
  sweptAt: string | null; // newest indexedAt, null before the first sweep
  // Indexable sources not yet swept — EXCLUDES running sessions (deliberately
  // skipped while live) so the count doesn't stick above zero.
  unindexed: number;
  hidden: BrainHidden;
}

export interface BrainSearchMatch {
  field: "title" | "summary" | "topic" | "content";
  snippet: string;
}

export interface BrainSearchResult {
  topics: Array<BrainTopic & { docCount: number }>;
  docs: Array<{
    id: string;
    kind: BrainDocKind;
    title: string;
    matches: BrainSearchMatch[];
  }>;
}

// Discoveries — cross-document insights the sweep synthesizes from the whole
// graph after indexing: growing trends, threads of work, recurring patterns,
// suggested fixes. Kept in data/brain/discoveries.json; updated (not
// re-invented) across sweeps; dismissed ones are tombstones the sweep must
// not resurrect.
// trend/thread/pattern/fix are the original within-graph kinds. correlation,
// contradiction, and silence push toward the non-obvious: cross-topic links the
// graph implies, docs that conflict, and threads that went quiet.
export type BrainDiscoveryKind =
  | "trend"
  | "thread"
  | "pattern"
  | "fix"
  | "correlation"
  | "contradiction"
  | "silence";

// A discovery starts life as a HYPOTHESIS (internal evidence: the graph's
// docs). A separate research pass then tries to prove or refute it against
// the outside world — Slack, Linear, Datadog, Snowflake, GitHub, etc. —
// via the same connector access the morning sweep uses. The verification
// (verdict + sourced external evidence + a written conclusion) lives on the
// record and is preserved across sweeps until the hypothesis itself changes.
//
// "deferred" is a soft pause, not a failure: the research call hit the Claude
// usage limit, so we leave the hypothesis to retry on the next sweep rather
// than recording a bogus failure. "failed" is reserved for real errors.
export type BrainVerificationStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "deferred";
export type BrainVerdict = "confirmed" | "partial" | "refuted" | "inconclusive";

export interface BrainEvidence {
  source: string; // "slack" | "linear" | "datadog" | "snowflake" | "github" | …
  summary: string; // what was found, one or two sentences
  ref: string | null; // permalink / ticket id / query — something checkable
  supports: boolean; // supports the hypothesis, or contradicts it
}

export interface BrainVerification {
  status: BrainVerificationStatus;
  verdict: BrainVerdict | null; // null until status is "done"
  detail: string; // markdown: method, findings, conclusion
  evidence: BrainEvidence[];
  checkedAt: string | null; // ISO
}

export interface BrainDiscovery {
  id: string; // stable kebab slug chosen by the sweep
  kind: BrainDiscoveryKind;
  title: string;
  insight: string; // 2-4 plain sentences on what's emerging and why it matters
  topics: string[]; // related topic slugs
  docs: string[]; // internal evidence doc ids ("learning:…" / "session:…")
  status: "active" | "dismissed";
  hidden: boolean; // hidden from the default view, reversibly (≠ dismissed)
  firstSeen: string; // ISO — survives updates, shows how long it's been live
  lastSeen: string; // ISO — bumped each sweep that reconfirms it
  verification: BrainVerification;
}

export interface BrainSweepJob {
  id: string;
  status: SweepStatus;
  startedAt: string; // ISO
  total: number; // docs to index this run
  done: number; // docs indexed so far
  batches: number;
  batch: number; // current batch, 1-based (0 while scanning)
  topicTotal: number; // topics queued for (re)summary this run (membership changed)
  topicsSummarized: number; // topic summaries finished so far
  synthesizing: boolean; // the post-index discoveries pass is running
  verifyTotal: number; // hypotheses queued for external verification this run
  verified: number; // verifications finished so far (done, failed, or deferred)
  verifyDeferred: number; // verifications paused this run on the usage limit
  newTopics: number;
  newLinks: number;
  newDiscoveries: number;
  error: string | null;
}

// Per-routine progress within a sweep, so the UI can show what it's waiting on
// (one entry per routine in ROUTINES, in run order).
export type RoutineStatus = "pending" | "running" | "done" | "failed";
export interface RoutineProgress {
  name: string;
  label: string;
  status: RoutineStatus;
}

export interface SweepJob {
  id: string;
  status: SweepStatus;
  date: string;
  label: string;
  editionId: number | null;
  error: string | null;
  routines: RoutineProgress[];
}

// ---- configuration (the abstraction layer) ----
// Everything personal- or org-specific lives here so the shipped repo stays
// generic. The user's real values live in a gitignored data/config.json; the
// repo ships dayboard.config.example.json as a documented template. Routine
// prompts reference these values via {{dotted.path}} placeholders, and a user
// can fully replace any prompt with a gitignored override (data/routines/).

// The six built-in nav tabs. Each can be toggled off in config.
export type TabId =
  | "today"
  | "trends"
  | "prs"
  | "learnings"
  | "sessions"
  | "brain";

// One sweep routine: a prompt file (by `name`) run during a sweep to produce
// section cards. `enabled` and order are config-driven.
export interface RoutineConfig {
  name: string; // stable id; also the prompt filename stem (routines/<name>.md)
  label: string; // shown in the sweep progress indicator
  enabled: boolean;
}

// A connector the routines may use (Slack, Linear, …). Declared here so the
// setup-check can report what's expected; routines match on tool-name patterns.
export interface ConnectorConfig {
  id: string; // "slack" | "linear" | … (matches MCP tool-name patterns)
  label: string;
  enabled: boolean;
}

// A Slack review channel for a repo (the PRs tab). `verified` distinguishes a
// known-correct mapping from an inferred one (repo without CODEOWNERS).
export interface RepoChannel {
  channel: string;
  verified: boolean;
}

// Keyword routing within one repo (first matching rule wins) — for monorepos
// whose review channel depends on the changed area. Matches are `verified`.
export interface RepoKeywordRule {
  keywords: string[];
  channel: string;
}

export interface DayboardConfig {
  identity: {
    name: string; // greeting + how routines refer to the user; "" = omit
    addressAs: string; // 2nd-person address used in routine prompts ("you")
  };
  paths: {
    learningsDir: string; // reference docs (the Learnings tab + brain)
    claudeProjectsDir: string; // Claude Code transcripts (the Sessions tab + brain)
  };
  schedule: {
    hour: number; // 0–23, local — drives the morning launchd agent
    minute: number; // 0–59
  };
  models: {
    tag: string; // cheap tier for session tagging / brain indexing
    reason: string; // mid tier for the morning brief's connector reasoning
  };
  github: {
    org: string; // org scoped by the PRs tab; "" disables PR fetching
    defaultChannel: string; // fallback review channel (verified: false)
    repoChannels: Record<string, RepoChannel>; // repo name -> channel
    repoKeywordRules: Record<string, RepoKeywordRule[]>; // repo -> area routing
  };
  tabs: Record<TabId, boolean>;
  routines: RoutineConfig[];
  connectors: ConnectorConfig[];
}

// One setup-check result, surfaced in the admin panel's diagnostics.
export interface ConfigCheckItem {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}
export interface ConfigCheck {
  ok: boolean; // false if any check failed
  checks: ConfigCheckItem[];
}

// How a routine's prompt was resolved (for the admin "view prompt" panel).
export type RoutinePromptSource = "override" | "template" | "none";
export interface RoutinePrompt {
  name: string;
  label: string;
  enabled: boolean;
  source: RoutinePromptSource;
  raw: string; // the prompt as stored (override if present, else template)
  rendered: string; // after {{placeholder}} substitution from config
}
