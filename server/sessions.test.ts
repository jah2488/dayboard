import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// sessions.ts reads CLAUDE_PROJECTS_DIR / CLAUDE_SESSIONS_DIR at import time, and
// the summarizer shells out to `claude` — so set the dirs + SWEEP_MOCK first and
// import lazily (same pattern as learnings.test.ts).
process.env.SWEEP_MOCK = "1";

let sessions: typeof import("./sessions.ts");

const SESSION_ID = "2131ab31-26e2-4a7c-905f-47037d7628ba";

// A compact transcript: one prompt, an assistant turn with a web search + edit,
// a tool_result, a pr-link, then a learnings Write + closing message.
const events = [
  { type: "ai-title", aiTitle: "Add a rate-limit UI" },
  {
    type: "user",
    cwd: "/Users/x/Projects/web-app/.claude/worktrees/abc",
    gitBranch: "claude/abc",
    timestamp: "2026-06-08T10:00:00.000Z",
    message: { role: "user", content: "Add a rate-limit UI to admin." },
  },
  {
    type: "assistant",
    timestamp: "2026-06-08T10:01:00.000Z",
    message: {
      model: "claude-opus-4-8",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 0,
        output_tokens: 40,
        server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
      },
      content: [
        { type: "text", text: "On it." },
        { type: "tool_use", name: "WebSearch", input: { query: "rate limit" } },
        { type: "tool_use", name: "Edit", input: { file_path: "/Users/x/Projects/web-app/x.ts" } },
      ],
    },
  },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } },
  {
    type: "pr-link",
    prNumber: 1679,
    prUrl: "https://github.com/acme/web-app/pull/1679",
    prRepository: "acme/web-app",
  },
  {
    type: "assistant",
    timestamp: "2026-06-08T10:05:00.000Z",
    message: {
      model: "claude-opus-4-8",
      usage: { input_tokens: 50, cache_read_input_tokens: 200, cache_creation_input_tokens: 0, output_tokens: 200 },
      content: [
        { type: "tool_use", name: "Write", input: { file_path: "/Users/x/Projects/learnings/2026-06-08-note.md" } },
        { type: "text", text: "Done — shipped the UI." },
      ],
    },
  },
];

beforeAll(async () => {
  const projects = mkdtempSync(join(tmpdir(), "dayboard-proj-"));
  const projDir = join(projects, "-Users-x-Projects-web-app");
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, `${SESSION_ID}.jsonl`),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );

  // A live-session state file whose pid is THIS process — `ps` will show the
  // vitest/node command, not "claude", so liveness deterministically resolves
  // to false (we can't conjure a real claude process in CI).
  const sessionsDir = mkdtempSync(join(tmpdir(), "dayboard-sess-"));
  writeFileSync(
    join(sessionsDir, `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId: SESSION_ID, kind: "interactive", status: "idle" }),
  );

  // A matching learning doc so the link resolves to a title.
  writeFileSync(
    join(process.env.LEARNINGS_DIR!, "2026-06-08-note.md"),
    "# Rate-limit notes\n\nbody",
  );

  process.env.CLAUDE_PROJECTS_DIR = projects;
  process.env.CLAUDE_SESSIONS_DIR = sessionsDir;
  sessions = await import("./sessions.ts");
});

describe("listSessions", () => {
  it("derives project, title, counts, and stats from the transcript", () => {
    const list = sessions.listSessions();
    expect(list).toHaveLength(1);
    const s = list[0];
    expect(s.id).toBe(SESSION_ID);
    expect(s.project).toBe("web-app"); // from the worktree cwd
    expect(s.title).toBe("Add a rate-limit UI");
    expect(s.prCount).toBe(1);
    expect(s.learningCount).toBe(1);
    expect(s.stats.toolCalls.total).toBe(3);
    expect(s.running).toBe(false); // pid alive, but not a claude process
    expect(s.origin).toBe("direct"); // no headless entrypoint -> a real session
  });
});

describe("getSession", () => {
  it("returns full detail with resolved PRs, learnings, and turns", () => {
    const d = sessions.getSession(SESSION_ID)!;
    expect(d.goal).toBe("Add a rate-limit UI to admin.");
    expect(d.results).toBe("Done — shipped the UI.");
    expect(d.gitBranch).toBe("claude/abc");
    expect(d.prs[0].number).toBe(1679);
    expect(d.learnings).toEqual([
      { file: "2026-06-08-note.md", title: "Rate-limit notes" },
    ]);
    expect(d.turns.map((t) => t.role)).toEqual(["user", "assistant", "assistant"]);
    expect(d.summary).toBeNull();
  });

  it("rejects unknown and unsafe ids", () => {
    expect(sessions.getSession("nope")).toBeNull();
    expect(sessions.getSession("../../etc/passwd")).toBeNull();
  });
});

describe("summarizeSession", () => {
  it("caches a summary (mock) and surfaces it on the next detail read", async () => {
    const summary = await sessions.summarizeSession(SESSION_ID);
    expect(summary?.goal).toContain("Add a rate-limit UI");
    expect(summary?.model).toBe("claude-opus-4-8");
    expect(sessions.getSession(SESSION_ID)?.summary?.outcome).toBe("Mock outcome.");
  });

  it("returns null for an unknown session", async () => {
    expect(await sessions.summarizeSession("nope")).toBeNull();
  });
});
