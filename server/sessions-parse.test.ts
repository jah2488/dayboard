import { describe, expect, it } from "vitest";
import {
  buildTurns,
  collectLearningFiles,
  collectPrs,
  computeStats,
  firstEntrypoint,
  firstUserPrompt,
  isDashboardRoutine,
  lastAssistantText,
  projectFromCwd,
  sessionOrigin,
  aiTitle,
} from "./sessions-parse.ts";

// A compact but representative transcript: one real prompt, two assistant
// turns (one with a web search + edit, one with a learnings write), a tool
// result, a pr-link, and an ai-title.
const events = [
  { type: "ai-title", aiTitle: "First title" },
  {
    type: "user",
    cwd: "/Users/j/Projects/web-app/.claude/worktrees/abc",
    gitBranch: "claude/abc",
    timestamp: "2026-06-08T10:00:00.000Z",
    message: { role: "user", content: "Add a rate-limit UI" },
  },
  {
    type: "assistant",
    timestamp: "2026-06-08T10:01:00.000Z",
    message: {
      model: "claude-opus-4-8",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 500,
        output_tokens: 40,
        server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 },
      },
      content: [
        { type: "text", text: "Looking into it." },
        { type: "tool_use", name: "WebSearch", input: { query: "rate limit" } },
        { type: "tool_use", name: "Edit", input: { file_path: "/Users/j/Projects/web-app/x.ts" } },
      ],
    },
  },
  {
    type: "user",
    timestamp: "2026-06-08T10:02:00.000Z",
    message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
  },
  { type: "ai-title", aiTitle: "Final title" },
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
      usage: { input_tokens: 50, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, output_tokens: 200 },
      content: [
        { type: "tool_use", name: "Write", input: { file_path: "/Users/j/Projects/learnings/2026-06-08-note.md" } },
        { type: "text", text: "Done — shipped the UI." },
      ],
    },
  },
];

describe("metadata", () => {
  it("takes the last ai-title and the repo from a worktree cwd", () => {
    expect(aiTitle(events as never)).toBe("Final title");
    expect(projectFromCwd("/Users/j/Projects/web-app/.claude/worktrees/abc")).toBe("web-app");
  });

  it("derives goal from the first string prompt and results from the last assistant text", () => {
    expect(firstUserPrompt(events as never)).toBe("Add a rate-limit UI");
    expect(lastAssistantText(events as never)).toBe("Done — shipped the UI.");
  });

  it("computes the session window (on stats)", () => {
    const s = computeStats(events as never);
    expect(s.startedAt).toBe("2026-06-08T10:00:00.000Z");
    expect(s.endedAt).toBe("2026-06-08T10:05:00.000Z");
  });
});

describe("computeStats", () => {
  it("counts messages, tools, web use, and tokens", () => {
    const s = computeStats(events as never);
    expect(s.userMessages).toBe(1); // tool_result turn is not a real prompt
    expect(s.assistantMessages).toBe(2);
    expect(s.toolCalls.total).toBe(3);
    expect(s.toolCalls.byName).toContainEqual({ name: "Edit", count: 1 });
    // 2 server web_search_requests + 1 WebSearch tool call
    expect(s.web.searches).toBe(3);
    expect(s.web.fetches).toBe(0);
    expect(s.tokens.contextHighWater).toBe(3050); // peak is turn 2: 50+3000+0
    expect(s.tokens.totalOutput).toBe(240);
    expect(s.models).toEqual(["claude-opus-4-8"]);
    expect(s.durationMs).toBe(5 * 60 * 1000);
  });
});

describe("associations", () => {
  it("collects de-duped PRs and learning files", () => {
    expect(collectPrs(events as never)).toEqual([
      { number: 1679, url: "https://github.com/acme/web-app/pull/1679", repository: "acme/web-app" },
    ]);
    expect(collectLearningFiles(events as never)).toEqual(["2026-06-08-note.md"]);
  });
});

describe("sessionOrigin", () => {
  const userEvent = (over: Record<string, unknown>) => [
    { type: "ai-title", aiTitle: "t" },
    { type: "user", message: { role: "user", content: "go" }, ...over },
  ];

  it("reads the first user event's entrypoint", () => {
    expect(firstEntrypoint(userEvent({ entrypoint: "sdk-cli" }) as never)).toBe("sdk-cli");
    expect(firstEntrypoint(userEvent({}) as never)).toBeNull();
  });

  it("treats interactive entrypoints as direct", () => {
    expect(sessionOrigin(userEvent({ entrypoint: "cli" }) as never)).toBe("direct");
    expect(sessionOrigin(userEvent({ entrypoint: "claude-desktop" }) as never)).toBe("direct");
  });

  it("treats sdk-cli (and any other headless entrypoint) as agent", () => {
    expect(sessionOrigin(userEvent({ entrypoint: "sdk-cli" }) as never)).toBe("agent");
    expect(sessionOrigin(userEvent({ entrypoint: "some-headless" }) as never)).toBe("agent");
  });

  it("falls back to promptSource 'sdk' -> agent when no entrypoint is stamped", () => {
    expect(sessionOrigin(userEvent({ promptSource: "sdk" }) as never)).toBe("agent");
    expect(sessionOrigin(userEvent({ promptSource: "user" }) as never)).toBe("direct");
  });

  it("defaults to direct when there is no entrypoint or promptSource signal", () => {
    expect(sessionOrigin(events as never)).toBe("direct");
  });
});

describe("isDashboardRoutine", () => {
  const routine = (prompt: string, over: Record<string, unknown> = {}) => [
    { type: "user", message: { role: "user", content: prompt }, entrypoint: "sdk-cli", ...over },
  ];

  it("flags the dashboard's own agent routine transcripts", () => {
    for (const p of [
      "You are the librarian of Sam's personal knowledge graph. Read…",
      "You are the analyst of Sam's personal knowledge graph. Read…",
      "You are the investigator for Sam's personal knowledge graph…",
      "Generate Sam's morning brief for today.",
      "Produce a READ-ONLY snapshot of Sam's Partner Tracker for their dashboard.",
    ]) {
      expect(isDashboardRoutine(routine(p) as never)).toBe(true);
    }
  });

  it("never flags a real interactive session, even one discussing the graph", () => {
    // origin gate: a typed (cli) session is immune regardless of content.
    expect(
      isDashboardRoutine(
        routine("Let's improve Sam's personal knowledge graph UI", { entrypoint: "cli" }) as never,
      ),
    ).toBe(false);
  });

  it("does not flag an agent session doing real work", () => {
    expect(isDashboardRoutine(routine("Fix the domain management 500s") as never)).toBe(false);
  });
});

describe("buildTurns", () => {
  it("emits user prompts and assistant turns with tool calls, skipping tool_result turns", () => {
    const turns = buildTurns(events as never);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "assistant"]);
    expect(turns[1].toolCalls.map((t) => t.name)).toEqual(["WebSearch", "Edit"]);
    expect(turns[2].text).toBe("Done — shipped the UI.");
  });
});
