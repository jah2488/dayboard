import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BrainConnections } from "../shared/types.ts";

// Liveness detection (`ps` over real pids) is the wrong thing to race in a unit
// test of getBrainGraph's math, so stub it at the boundary: tests set which
// session ids are "running" deterministically. Everything else in sessions.ts
// stays real (listBrainSessions reads the real tmp transcripts).
const { running } = vi.hoisted(() => ({ running: { ids: new Set<string>() } }));
vi.mock("./sessions.ts", async (orig) => ({
  ...(await orig<typeof import("./sessions.ts")>()),
  runningSessionIds: () => running.ids,
}));

// brain-store/learnings/sessions resolve their dirs at import time, so stage
// the tmp fixture first and import lazily (same pattern as learnings.test.ts).
let brain: typeof import("./brain.ts");

const SESSION_ID = "9f0c2a4e-1111-2222-3333-444455556666";
const ALPHA_DOC = "learning:2026-06-08-project-alpha-prep.md";
const SESSION_DOC = `session:${SESSION_ID}`;
const GONE_DOC = "learning:2026-06-05-deleted.md";

const conn = (id: string, over: Partial<BrainConnections>): BrainConnections => ({
  id,
  kind: id.startsWith("learning:") ? "learning" : "session",
  title: id,
  date: null,
  summary: "",
  origin: id.startsWith("learning:") ? "direct" : "agent",
  topics: [],
  linksTo: [],
  linkedFrom: [],
  sourceMtime: 1,
  indexedAt: "2026-06-10T07:00:00.000Z",
  ...over,
});

beforeAll(async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "dayboard-brain-learnings-"));
  writeFileSync(
    join(learningsDir, "2026-06-08-project-alpha-prep.md"),
    "# Project Alpha renewal prep\n\nThe Project Alpha renewal needs a readiness review.\nUnrelated line.\n",
  );
  writeFileSync(
    join(learningsDir, "2026-06-01-project-beta.md"),
    "# Project Beta POC\n\nproject-beta storefront notes\n",
  );
  writeFileSync(
    join(learningsDir, "2026-06-10-extra.md"),
    "# Extra\n" + Array.from({ length: 5 }, (_, i) => `pentamatch line ${i}`).join("\n"),
  );

  const projectsDir = mkdtempSync(join(tmpdir(), "dayboard-brain-proj-"));
  mkdirSync(join(projectsDir, "-Users-x-Projects-dayboard"));
  writeFileSync(
    join(projectsDir, "-Users-x-Projects-dayboard", `${SESSION_ID}.jsonl`),
    JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n",
  );
  process.env.LEARNINGS_DIR = learningsDir;
  process.env.CLAUDE_PROJECTS_DIR = projectsDir;
  process.env.CLAUDE_SESSIONS_DIR = mkdtempSync(join(tmpdir(), "dayboard-brain-sess-"));
  process.env.DAYBOARD_BRAIN_DIR = mkdtempSync(join(tmpdir(), "dayboard-brain-"));

  const store = await import("./brain-store.ts");
  store.writeTopics([
    { slug: "project-alpha", label: "Project Alpha", description: "Project Alpha partner work", summary: "", summaryFingerprint: "" },
    { slug: "snowflake", label: "Snowflake", description: "warehouse", summary: "", summaryFingerprint: "" },
  ]);
  store.writeConnections(
    conn(ALPHA_DOC, {
      title: "Project Alpha renewal prep",
      date: "2026-06-08",
      summary: "Prep notes for the Project Alpha renewal.",
      topics: [{ slug: "project-alpha", strength: 0.9, excerpt: "renewal needs a readiness review" }],
      linksTo: [{ id: SESSION_DOC, reason: "Session produced this doc.", origin: "artifact" }],
    }),
  );
  store.writeConnections(
    conn(SESSION_DOC, {
      title: "Dayboard hacking",
      summary: "A coding session.",
      topics: [{ slug: "project-alpha", strength: 0.4, excerpt: null }],
      linkedFrom: [{ id: ALPHA_DOC, reason: "Session produced this doc.", origin: "artifact" }],
      indexedAt: "2026-06-11T07:00:00.000Z",
    }),
  );
  store.writeConnections(conn(GONE_DOC, { title: "Deleted doc", summary: "source vanished" }));

  brain = await import("./brain.ts");
});

describe("getBrainGraph", () => {
  it("aggregates docs, flags missing sources, and counts the unindexed", () => {
    const g = brain.getBrainGraph();
    expect(g.docs.map((d) => [d.id, d.missing]).sort()).toEqual(
      [
        [ALPHA_DOC, false],
        [SESSION_DOC, false],
        [GONE_DOC, true],
      ].sort(),
    );
    // project-beta + extra exist on disk but have no connections file.
    expect(g.unindexed).toBe(2);
    expect(g.sweptAt).toBe("2026-06-11T07:00:00.000Z");
  });

  it("surfaces each doc's origin (learning direct, this session agent) and an empty hidden set", () => {
    const g = brain.getBrainGraph();
    const byId = Object.fromEntries(g.docs.map((d) => [d.id, d.origin]));
    expect(byId[ALPHA_DOC]).toBe("direct");
    expect(byId[SESSION_DOC]).toBe("agent");
    expect(g.hidden).toEqual({ docs: [], topics: [] });
  });

  it("computes per-topic docCount from the indexed docs", () => {
    const topics = brain.getBrainGraph().topics;
    expect(topics.find((t) => t.slug === "project-alpha")?.docCount).toBe(2);
    expect(topics.find((t) => t.slug === "snowflake")?.docCount).toBe(0);
  });

  it("emits each doc-doc link once with reason and origin", () => {
    expect(brain.getBrainGraph().links).toEqual([
      { from: ALPHA_DOC, to: SESSION_DOC, reason: "Session produced this doc.", origin: "artifact" },
    ]);
  });
});

describe("getBrainDoc", () => {
  it("returns a single connections record by id", () => {
    expect(brain.getBrainDoc(ALPHA_DOC)?.title).toBe("Project Alpha renewal prep");
  });

  it("rejects unknown and unsafe ids", () => {
    expect(brain.getBrainDoc("learning:nope.md")).toBeNull();
    expect(brain.getBrainDoc("learning:../../etc/passwd")).toBeNull();
    expect(brain.getBrainDoc("bogus")).toBeNull();
  });
});

describe("searchBrain", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(brain.searchBrain("")).toEqual({ topics: [], docs: [] });
    expect(brain.searchBrain("   ")).toEqual({ topics: [], docs: [] });
  });

  it("matches topics and docs case-insensitively across fields", () => {
    const r = brain.searchBrain("ALPHA");
    expect(r.topics.map((t) => t.slug)).toEqual(["project-alpha"]);
    expect(r.topics[0].docCount).toBe(2);

    const doc = r.docs.find((d) => d.id === ALPHA_DOC)!;
    const fields = doc.matches.map((m) => m.field);
    expect(fields).toContain("title");
    expect(fields).toContain("topic"); // slug match surfaces the excerpt
    expect(fields).toContain("content");
    // session matched via its topic slug even with a null excerpt
    expect(r.docs.find((d) => d.id === SESSION_DOC)?.matches).toEqual([
      { field: "topic", snippet: "project-alpha" },
    ]);
  });

  it("greps learnings content even for unindexed docs", () => {
    const r = brain.searchBrain("project-beta");
    const doc = r.docs.find((d) => d.id === "learning:2026-06-01-project-beta.md")!;
    expect(doc.kind).toBe("learning");
    expect(doc.title).toBe("Project Beta POC");
    expect(doc.matches).toEqual([
      { field: "content", snippet: "project-beta storefront notes" },
    ]);
  });

  it("caps content matches at 3 per doc", () => {
    const doc = brain.searchBrain("pentamatch").docs[0];
    expect(doc.matches).toHaveLength(3);
    expect(doc.matches.every((m) => m.field === "content")).toBe(true);
  });
});

// A live session has no connections file (the sweep skips it while running), so
// it would inflate the unindexed tally forever — the fix subtracts running ids.
describe("getBrainGraph — unindexed excludes running sessions", () => {
  const RUNNING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const STALE_ID = "11111111-2222-3333-4444-555555555555";

  beforeAll(() => {
    const projDir = join(process.env.CLAUDE_PROJECTS_DIR!, "-Users-x-Projects-dayboard");
    // Two more unindexed sessions on disk: one running, one stale.
    for (const id of [RUNNING_ID, STALE_ID]) {
      writeFileSync(
        join(projDir, `${id}.jsonl`),
        JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n",
      );
    }
    running.ids = new Set([RUNNING_ID]);
  });

  it("counts the stale session but not the running one", () => {
    const g = brain.getBrainGraph();
    // Baseline 2 unindexed learnings + the stale session = 3; the running one
    // is subtracted out even though it's on disk with no connections file.
    expect(g.unindexed).toBe(3);
  });
});

describe("getBrainGraph — hidden", () => {
  it("returns the hidden sets and still keeps hidden ids in docs/topics (UI ghosts them)", async () => {
    const store = await import("./brain-store.ts");
    store.writeHidden({ docs: [ALPHA_DOC], topics: ["project-alpha"] });
    try {
      const g = brain.getBrainGraph();
      expect(g.hidden).toEqual({ docs: [ALPHA_DOC], topics: ["project-alpha"] });
      // Not filtered server-side: the hidden doc and topic are still present.
      expect(g.docs.map((d) => d.id)).toContain(ALPHA_DOC);
      expect(g.topics.map((t) => t.slug)).toContain("project-alpha");
    } finally {
      store.writeHidden({ docs: [], topics: [] });
    }
  });
});
