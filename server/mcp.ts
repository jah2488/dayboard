// dayboard MCP server (stdio) — lets Claude read and act on the board.
// It's a thin client over the local HTTP API, so the dayboard server must be
// running (npm start, or the launchd agent). Register it with:
//   claude mcp add dayboard -- <abs>/node_modules/.bin/tsx <abs>/server/mcp.ts
//
// IMPORTANT: stdout is the MCP transport — never print to it. Logs go to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.DAYBOARD_URL ?? "http://localhost:4747";
const today = () => new Date().toISOString().slice(0, 10);

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: `Error: ${e instanceof Error ? e.message : String(e)}. Is the dayboard server running at ${BASE}?`,
    },
  ],
  isError: true,
});

const server = new McpServer({ name: "dayboard", version: "0.1.0" });

server.tool(
  "get_day",
  "Get a full day view (greeting, editions, sections, tasks). Defaults to today.",
  { date: z.string().optional().describe("YYYY-MM-DD; defaults to today") },
  async ({ date }) => {
    try {
      return ok(await call(`/api/days/${date ?? today()}`));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "list_tasks",
  "List the current task, open backlog, and tasks completed on a given day (default today).",
  { date: z.string().optional() },
  async ({ date }) => {
    try {
      const day = (await call(`/api/days/${date ?? today()}`)) as {
        tasks: unknown;
      };
      return ok(day.tasks);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "create_task",
  "Create a task. Set makeCurrent to pin it as the single 'right now' focus.",
  {
    title: z.string().describe("Task text; markdown links are kept and clickable"),
    makeCurrent: z.boolean().optional(),
    sourceDate: z.string().optional(),
  },
  async ({ title, makeCurrent, sourceDate }) => {
    try {
      return ok(
        await call("/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            title,
            isCurrent: makeCurrent ?? false,
            sourceDate: sourceDate ?? today(),
          }),
        }),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "complete_task",
  "Mark a task done.",
  { id: z.number() },
  async ({ id }) => {
    try {
      return ok(await call(`/api/tasks/${id}/complete`, { method: "POST" }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "set_current_task",
  "Pin an existing task as the single 'right now' focus.",
  { id: z.number() },
  async ({ id }) => {
    try {
      return ok(await call(`/api/tasks/${id}/current`, { method: "POST" }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "delete_task",
  "Delete (soft) a task.",
  { id: z.number() },
  async ({ id }) => {
    try {
      return ok(await call(`/api/tasks/${id}`, { method: "DELETE" }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "add_section",
  "Add a triage card to a day's newest edition (creates one if needed).",
  {
    title: z.string(),
    bodyMd: z.string().describe("Markdown; use links so items are clickable"),
    source: z
      .enum([
        "slack",
        "github",
        "notion",
        "linear",
        "datadog",
        "email",
        "calendar",
        "partner-tracker",
        "morning-brief",
      ])
      .optional(),
    date: z.string().optional(),
  },
  async ({ title, bodyMd, source, date }) => {
    try {
      return ok(
        await call("/api/sections", {
          method: "POST",
          body: JSON.stringify({ title, bodyMd, source, date }),
        }),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "search_brain",
  "Search the personal knowledge graph (topics + indexed learnings/sessions) by text.",
  { query: z.string() },
  async ({ query }) => {
    try {
      return ok(await call(`/api/brain/search?q=${encodeURIComponent(query)}`));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "get_brain_discoveries",
  "List active brain discoveries — cross-document trends, threads, patterns, and suggested fixes the daily sweep synthesizes from the knowledge graph.",
  {},
  async () => {
    try {
      return ok(await call("/api/brain/discoveries"));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "verify_discovery",
  "Research one brain discovery (hypothesis) against the available connectors (Slack/Linear/Datadog/Snowflake/GitHub, etc.). Returns the record flipped to 'running'; poll get_brain_discoveries for the verdict.",
  { id: z.string().describe("Discovery id, e.g. project-alpha-thread") },
  async ({ id }) => {
    try {
      return ok(
        await call(`/api/brain/discoveries/${encodeURIComponent(id)}/verify`, {
          method: "POST",
        }),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "trigger_brain_sweep",
  "Kick off a brain sweep (index new/changed learnings + sessions into the knowledge graph). Returns a job.",
  { force: z.boolean().optional().describe("Re-index everything, not just stale docs") },
  async ({ force }) => {
    try {
      return ok(
        await call("/api/brain/sweep", {
          method: "POST",
          body: JSON.stringify({ force: !!force }),
        }),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "trigger_sweep",
  "Kick off a fresh sweep for today (creates a new edition). Returns a job id.",
  { label: z.string().optional() },
  async ({ label }) => {
    try {
      return ok(
        await call("/api/sweep", {
          method: "POST",
          body: JSON.stringify({ date: today(), label }),
        }),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[dayboard-mcp] connected over stdio");
