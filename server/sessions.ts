import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as repo from "./repo.ts";
import { listLearnings } from "./learnings.ts";
import { getConfig } from "./config.ts";
import { runClaude } from "./claude.ts";
import {
  aiTitle,
  buildTurns,
  collectLearningFiles,
  collectPrs,
  computeStats,
  firstCwd,
  firstUserPrompt,
  gitBranch,
  isDashboardRoutine,
  lastAssistantText,
  projectFromCwd,
  sessionOrigin,
} from "./sessions-parse.ts";
import type {
  SessionDetail,
  SessionLearningLink,
  SessionListItem,
  SessionSummaryCache,
} from "../shared/types.ts";

// Claude Code transcripts + live-session state. The transcripts dir is
// config-driven (paths.claudeProjectsDir), resolved per call; the transient
// live-sessions dir stays a plain env knob.
const projectsDir = () => getConfig().paths.claudeProjectsDir;
const SESSIONS_DIR =
  process.env.CLAUDE_SESSIONS_DIR ?? join(homedir(), ".claude", "sessions");

const SESSION_ID = /^[A-Za-z0-9-]+$/;
const GOAL_PREVIEW = 280;

type Event = Record<string, unknown>;

function readEvents(file: string): Event[] {
  const raw = readFileSync(file, "utf8");
  const events: Event[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      events.push(JSON.parse(s) as Event);
    } catch {
      // Skip partial/corrupt lines (a transcript still being written).
    }
  }
  return events;
}

// Every top-level *.jsonl transcript under ~/.claude/projects/<proj>/.
// Exported for the Brain: a cheap existence/mtime listing, no transcript parse.
export function transcriptFiles(): Array<{ id: string; path: string; mtime: number }> {
  const root = projectsDir();
  if (!existsSync(root)) return [];
  const out: Array<{ id: string; path: string; mtime: number }> = [];
  for (const proj of readdirSync(root)) {
    const dir = join(root, proj);
    let entries: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".jsonl")) continue;
      const path = join(dir, f);
      out.push({ id: f.replace(/\.jsonl$/, ""), path, mtime: statSync(path).mtimeMs });
    }
  }
  return out;
}

// Session ids whose CLI process is alive right now — the same liveness signal
// the claude-sessions sweep card uses: interactive kind + a live `claude` pid
// (guards against PID reuse). Best-effort; failures degrade to "not running".
function liveSessionIds(): Set<string> {
  const live = new Set<string>();
  if (!existsSync(SESSIONS_DIR)) return live;
  const byPid = new Map<number, string>(); // pid -> sessionId
  for (const f of readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8")) as Record<string, unknown>;
      if (s.kind !== "interactive" || !s.status || typeof s.sessionId !== "string") continue;
      if (typeof s.pid === "number") byPid.set(s.pid, s.sessionId);
    } catch {
      // ignore malformed state files
    }
  }
  if (!byPid.size) return live;
  try {
    const pids = [...byPid.keys()].join(",");
    const out = execFileSync("ps", ["-p", pids, "-o", "pid=,command="], {
      encoding: "utf8",
    });
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      if (/claude/i.test(m[2]) && byPid.has(pid)) live.add(byPid.get(pid)!);
    }
  } catch {
    // `ps` non-zero when no listed pid is alive — nothing is running.
  }
  return live;
}

// Session ids whose CLI process is alive right now. Exported for the Brain,
// whose unindexed tally must exclude live sessions (the sweep deliberately
// skips them, so they'd otherwise stick in the count forever).
export function runningSessionIds(): Set<string> {
  return liveSessionIds();
}

// Parse cache keyed by path+mtime so re-listing 200+ transcripts is cheap.
// `routine` (a dashboard automation transcript) is computed once with the item.
const cache = new Map<string, { mtime: number; item: SessionListItem; routine: boolean }>();

function listItem(
  id: string,
  events: Event[],
  mtime: number,
  live: Set<string>,
): SessionListItem {
  const cwd = firstCwd(events);
  const stats = computeStats(events);
  const goal = firstUserPrompt(events);
  const origin = sessionOrigin(events);
  const category = isDashboardRoutine(events)
    ? "sweep"
    : origin === "direct"
      ? "interactive"
      : "agent";
  return {
    id,
    project: projectFromCwd(cwd),
    cwd,
    title: aiTitle(events) ?? projectFromCwd(cwd),
    goalPreview: goal.length > GOAL_PREVIEW ? goal.slice(0, GOAL_PREVIEW) + "…" : goal,
    startedAt: stats.startedAt,
    endedAt: stats.endedAt,
    mtime,
    running: live.has(id),
    origin,
    category,
    tags: [], // enriched from brain topics at the API boundary
    stats,
    prCount: collectPrs(events).length,
    learningCount: collectLearningFiles(events).length,
  };
}

function allSessions(): Array<{ item: SessionListItem; routine: boolean }> {
  const live = liveSessionIds();
  const out: Array<{ item: SessionListItem; routine: boolean }> = [];
  for (const { id, path, mtime } of transcriptFiles()) {
    const hit = cache.get(path);
    if (hit && hit.mtime === mtime) {
      out.push({ item: { ...hit.item, running: live.has(id) }, routine: hit.routine });
    } else {
      const events = readEvents(path);
      const item = listItem(id, events, mtime, live);
      // category already encodes the routine classification — no second pass.
      const rec = { mtime, item, routine: item.category === "sweep" };
      cache.set(path, rec);
      out.push({ item: rec.item, routine: rec.routine });
    }
  }
  return out;
}

// Every transcript — the Sessions tab is a literal log, machinery included.
export function listSessions(): SessionListItem[] {
  return allSessions()
    .map((r) => r.item)
    .sort((a, b) => b.mtime - a.mtime);
}

// What the Brain may index: the user's own interactive work only. Dashboard
// routine runs (sweeps) were always excluded; agent/subagent runs are now too,
// because some tools spawn hundreds of near-identical subagents (e.g. a fan-out
// of verification subagents all tagged the same) that flood the graph, skew
// topic counts, and burn sweep tokens to index. They stay browsable in the
// Sessions tab; the Brain stays signal.
export function listBrainSessions(): SessionListItem[] {
  return allSessions()
    .filter((r) => r.item.category === "interactive")
    .map((r) => r.item)
    .sort((a, b) => b.mtime - a.mtime);
}

// Per-session token facts for the usage charts, reusing the same parse-cache
// the Sessions tab pays for. `isSweep` is the dashboard's own routine runs
// (the big recurring token consumers); tokens are input + output summed.
export function sessionUsageRecords(): Array<{
  id: string;
  startedAt: string | null;
  tokens: number;
  isSweep: boolean;
  origin: SessionListItem["origin"];
}> {
  return allSessions().map(({ item, routine }) => ({
    id: item.id,
    startedAt: item.startedAt,
    tokens: item.stats.tokens.totalOutput + item.stats.tokens.totalInput,
    isSweep: routine,
    origin: item.origin,
  }));
}

function findTranscript(id: string): string | null {
  if (!SESSION_ID.test(id)) return null;
  for (const t of transcriptFiles()) {
    if (t.id === id) return t.path;
  }
  return null;
}

// Resolve learning filenames a session wrote against the docs that still exist,
// so links don't dangle if a doc was renamed/removed.
function resolveLearnings(files: string[]): SessionLearningLink[] {
  if (!files.length) return [];
  const byFile = new Map(listLearnings().map((d) => [d.file, d.title]));
  return files.map((file) => ({ file, title: byFile.get(file) ?? null }));
}

export function getSession(id: string): SessionDetail | null {
  const path = findTranscript(id);
  if (!path) return null;
  const events = readEvents(path);
  const mtime = statSync(path).mtimeMs;
  const base = listItem(id, events, mtime, liveSessionIds());
  return {
    ...base,
    gitBranch: gitBranch(events),
    goal: firstUserPrompt(events),
    results: lastAssistantText(events),
    prs: collectPrs(events),
    learnings: resolveLearnings(collectLearningFiles(events)),
    turns: buildTurns(events),
    summary: repo.getSessionSummary(id),
  };
}

const SUMMARY_PROMPT = (goal: string, results: string, toolLine: string) => `\
You are summarizing a finished Claude Code coding session for a developer's dashboard.
Reply with ONLY a JSON object: {"goal": "...", "outcome": "..."}.
- "goal": one or two sentences on what the developer was trying to achieve.
- "outcome": one or two sentences on what actually happened / what shipped.
Be concrete and plain. No markdown, no preamble.

OPENING PROMPT:
${goal.slice(0, 4000)}

TOOL ACTIVITY: ${toolLine}

FINAL ASSISTANT MESSAGE:
${results.slice(0, 4000)}`;

function parseSummaryJson(out: string): { goal: string; outcome: string } | null {
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { goal?: unknown; outcome?: unknown };
    if (typeof o.goal === "string" && typeof o.outcome === "string") {
      return { goal: o.goal, outcome: o.outcome };
    }
  } catch {
    // fall through
  }
  return null;
}

// On-demand LLM enrichment, cached. Reuses the headless `claude` runner that
// powers the morning sweep. SWEEP_MOCK=1 short-circuits for tests.
export async function summarizeSession(id: string): Promise<SessionSummaryCache | null> {
  const detail = getSession(id);
  if (!detail) return null;

  if (process.env.SWEEP_MOCK === "1") {
    return repo.upsertSessionSummary({
      sessionId: id,
      goal: `Mock goal for ${detail.title}`,
      outcome: "Mock outcome.",
      model: detail.stats.models[0] ?? null,
    });
  }

  const toolLine =
    detail.stats.toolCalls.byName
      .slice(0, 8)
      .map((t) => `${t.name}×${t.count}`)
      .join(", ") || "none";
  // Pin a cheap tier — a one-paragraph summary shouldn't bill the user's
  // interactive default (often Opus). Configurable via models.reason.
  const out = await runClaude(
    SUMMARY_PROMPT(detail.goal, detail.results, toolLine),
    undefined,
    undefined,
    getConfig().models.reason,
  );
  const parsed = parseSummaryJson(out);
  if (!parsed) throw new Error("Could not parse a summary from Claude's reply.");
  return repo.upsertSessionSummary({
    sessionId: id,
    goal: parsed.goal,
    outcome: parsed.outcome,
    model: detail.stats.models[0] ?? null,
  });
}
