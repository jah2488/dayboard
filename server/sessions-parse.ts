// Pure transcript parsing for the Sessions tab — functional core, no I/O.
// Input is the already-parsed array of JSONL events from one Claude Code
// transcript (~/.claude/projects/<proj>/<sessionId>.jsonl). Everything here is
// derived deterministically from those events; the filesystem/DB/LLM live in
// sessions.ts (the imperative shell).

import type {
  SessionOrigin,
  SessionPr,
  SessionStats,
  SessionTurn,
} from "../shared/types.ts";

// A transcript event is heterogeneous JSON; we read it defensively.
type Event = Record<string, unknown>;
type Block = Record<string, unknown>;

const WEB_SEARCH = "WebSearch";
const WEB_FETCH = "WebFetch";
const LEARNINGS_MARKER = "/Projects/learnings/";
const EDITING_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

// ---- small accessors (tolerate missing/oddly-shaped events) ----

function eventTs(e: Event): string | null {
  return typeof e.timestamp === "string" ? e.timestamp : null;
}

function message(e: Event): Record<string, unknown> {
  return (e.message as Record<string, unknown>) ?? {};
}

function contentBlocks(e: Event): Block[] {
  const c = message(e).content;
  return Array.isArray(c) ? (c as Block[]) : [];
}

// A "real" user prompt carries string content; tool_result turns are arrays.
function userText(e: Event): string | null {
  if (e.type !== "user") return null;
  const c = message(e).content;
  return typeof c === "string" ? c : null;
}

function assistantText(e: Event): string {
  if (e.type !== "assistant") return "";
  return contentBlocks(e)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// ---- derived metadata ----

export function firstCwd(events: Event[]): string | null {
  for (const e of events) {
    if (typeof e.cwd === "string" && e.cwd) return e.cwd;
  }
  return null;
}

export function gitBranch(events: Event[]): string | null {
  for (const e of events) {
    if (typeof e.gitBranch === "string" && e.gitBranch) return e.gitBranch;
  }
  return null;
}

// Last ai-title wins — Claude refines it as the session evolves.
export function aiTitle(events: Event[]): string | null {
  let t: string | null = null;
  for (const e of events) {
    if (e.type === "ai-title" && typeof e.aiTitle === "string" && e.aiTitle) {
      t = e.aiTitle;
    }
  }
  return t;
}

// Repo dir under ~/Projects, robust to worktree paths like
// /Users/.../Projects/my-app/.claude/worktrees/foo.
export function projectFromCwd(cwd: string | null): string {
  if (!cwd) return "unknown";
  const m = cwd.match(/\/Projects\/([^/]+)/);
  if (m) return m[1];
  const tail = cwd.split("/").filter(Boolean).pop();
  return tail ?? "unknown";
}

// Claude Code stamps the first 'user' event with how the session was launched.
// Interactive sessions read 'cli' or 'claude-desktop'; headless `claude -p` via
// the SDK reads 'sdk-cli' (with promptSource 'sdk').
export function firstEntrypoint(events: Event[]): string | null {
  for (const e of events) {
    if (e.type !== "user") continue;
    return typeof e.entrypoint === "string" ? e.entrypoint : null;
  }
  return null;
}

function firstPromptSource(events: Event[]): string | null {
  for (const e of events) {
    if (e.type !== "user") continue;
    return typeof e.promptSource === "string" ? e.promptSource : null;
  }
  return null;
}

// Agent-vs-direct: programmatic `claude -p` runs (workflow subagents, the
// brain's own sweep/verify/synthesis, the morning brief) are "agent"; anything
// the user typed at an interactive CLI or desktop is "direct". A headless
// entrypoint (anything but 'cli'/'claude-desktop') or promptSource 'sdk' marks
// it "agent"; with no signal at all we default to "direct" rather than
// libel a real interactive session that predates the entrypoint field.
const DIRECT_ENTRYPOINTS = new Set(["cli", "claude-desktop"]);

export function sessionOrigin(events: Event[]): SessionOrigin {
  const entrypoint = firstEntrypoint(events);
  if (entrypoint) return DIRECT_ENTRYPOINTS.has(entrypoint) ? "direct" : "agent";
  return firstPromptSource(events) === "sdk" ? "agent" : "direct";
}

export function firstUserPrompt(events: Event[]): string {
  for (const e of events) {
    const t = userText(e);
    if (t && t.trim()) return t;
  }
  return "";
}

// The dashboard's own automated routines (brain sweep/synthesis/verify/topic,
// the morning brief, the tracker snapshot, the session inventory) run via
// `claude -p`, so each leaves a transcript the Brain would otherwise ingest as
// a "session" — a self-referential tail that never clears and floods the graph
// with the brain narrating itself. Matched on the NAME-INDEPENDENT stable
// phrases of the shipped prompts (the `{{identity.name}}` placeholder is
// rendered before the prompt runs, so we can't match the name) AND on
// agent-origin, so a real interactive session that merely mentions a phrase is
// never excluded. Heuristic: heavily rewritten prompt overrides may not match.
const ROUTINE_SIGNATURE =
  /knowledge graph|morning brief for today|READ-ONLY snapshot of|local Claude Code sessions/i;

export function isDashboardRoutine(events: Event[]): boolean {
  return sessionOrigin(events) === "agent" && ROUTINE_SIGNATURE.test(firstUserPrompt(events));
}

export function lastAssistantText(events: Event[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const t = assistantText(events[i]);
    if (t) return t;
  }
  return "";
}

// ---- stats ----

export function computeStats(events: Event[]): SessionStats {
  const byName = new Map<string, number>();
  const models = new Set<string>();
  let userMessages = 0;
  let assistantMessages = 0;
  let searches = 0;
  let fetches = 0;
  let contextHighWater = 0;
  let totalOutput = 0;
  let totalInput = 0;
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const e of events) {
    const t = eventTs(e);
    if (t) {
      const ms = Date.parse(t);
      if (!Number.isNaN(ms)) {
        if (ms < minTs) minTs = ms;
        if (ms > maxTs) maxTs = ms;
      }
    }

    if (userText(e) !== null) userMessages++;

    if (e.type === "assistant") {
      assistantMessages++;
      const m = message(e);
      if (typeof m.model === "string") models.add(m.model);

      const u = (m.usage as Record<string, unknown>) ?? {};
      const input = num(u.input_tokens);
      const cacheRead = num(u.cache_read_input_tokens);
      const cacheCreate = num(u.cache_creation_input_tokens);
      contextHighWater = Math.max(contextHighWater, input + cacheRead + cacheCreate);
      totalOutput += num(u.output_tokens);
      totalInput += input;

      const st = (u.server_tool_use as Record<string, unknown>) ?? {};
      searches += num(st.web_search_requests);
      fetches += num(st.web_fetch_requests);

      for (const b of contentBlocks(e)) {
        if (b.type === "tool_use" && typeof b.name === "string") {
          byName.set(b.name, (byName.get(b.name) ?? 0) + 1);
          if (b.name === WEB_SEARCH) searches++;
          if (b.name === WEB_FETCH) fetches++;
        }
      }
    }
  }

  const total = [...byName.values()].reduce((a, b) => a + b, 0);
  const hasWindow = minTs !== Infinity && minTs <= maxTs;
  return {
    userMessages,
    assistantMessages,
    toolCalls: {
      total,
      byName: [...byName.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    },
    web: { searches, fetches },
    tokens: { contextHighWater, totalOutput, totalInput },
    models: [...models],
    durationMs: hasWindow ? maxTs - minTs : null,
    startedAt: hasWindow ? new Date(minTs).toISOString() : null,
    endedAt: hasWindow ? new Date(maxTs).toISOString() : null,
  };
}

// PRs are emitted directly by Claude Code as `pr-link` events — no scraping.
export function collectPrs(events: Event[]): SessionPr[] {
  const byUrl = new Map<string, SessionPr>();
  for (const e of events) {
    if (e.type === "pr-link" && typeof e.prUrl === "string") {
      byUrl.set(e.prUrl, {
        number: num(e.prNumber),
        url: e.prUrl,
        repository: typeof e.prRepository === "string" ? e.prRepository : "",
      });
    }
  }
  return [...byUrl.values()];
}

// Learning docs this session wrote/edited — exact links, not date guesses.
export function collectLearningFiles(events: Event[]): string[] {
  const files = new Set<string>();
  for (const e of events) {
    if (e.type !== "assistant") continue;
    for (const b of contentBlocks(e)) {
      if (b.type !== "tool_use" || typeof b.name !== "string") continue;
      if (!EDITING_TOOLS.test(b.name)) continue;
      const input = (b.input as Record<string, unknown>) ?? {};
      const fp = input.file_path;
      if (typeof fp === "string" && fp.includes(LEARNINGS_MARKER)) {
        const base = fp.split("/").pop();
        if (base) files.add(base);
      }
    }
  }
  return [...files];
}

// ---- transcript turns for display ----

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// A readable one-liner for a tool call, picking the most telling input field.
function toolDetail(block: Block): string {
  const input = (block.input as Record<string, unknown>) ?? {};
  const fields = [
    "command",
    "file_path",
    "path",
    "pattern",
    "query",
    "url",
    "prompt",
    "description",
  ];
  for (const f of fields) {
    if (typeof input[f] === "string" && input[f]) {
      return trunc(input[f] as string, 300);
    }
  }
  try {
    return trunc(JSON.stringify(input), 200);
  } catch {
    return "";
  }
}

export function buildTurns(events: Event[]): SessionTurn[] {
  const turns: SessionTurn[] = [];
  for (const e of events) {
    const ut = userText(e);
    if (ut !== null) {
      turns.push({ role: "user", text: ut, ts: eventTs(e), toolCalls: [] });
      continue;
    }
    if (e.type === "assistant") {
      const text = assistantText(e);
      const toolCalls = contentBlocks(e)
        .filter((b) => b.type === "tool_use" && typeof b.name === "string")
        .map((b) => ({ name: b.name as string, detail: toolDetail(b) }));
      if (text || toolCalls.length) {
        turns.push({ role: "assistant", text, ts: eventTs(e), toolCalls });
      }
    }
  }
  return turns;
}
