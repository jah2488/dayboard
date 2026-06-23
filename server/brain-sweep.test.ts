import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PENDING_VERIFICATION } from "./brain-discover.ts";
import type { BrainSweepJob } from "../shared/types.ts";

// Everything resolves its dirs at import time, so stage tmp fixtures + env
// first and import lazily; SWEEP_MOCK short-circuits the claude call with a
// canned reply derived from the work file (full pipeline, no LLM).
process.env.SWEEP_MOCK = "1";

let sweep: typeof import("./brain-sweep.ts");
let brain: typeof import("./brain.ts");
let store: typeof import("./brain-store.ts");

const SESSION_ID = "7a31ab31-26e2-4a7c-905f-47037d7628ba";
// The dashboard's own sweep machinery — must never be indexed or counted.
const ROUTINE_ID = "11111111-2222-3333-4444-555555555555";
const NOTE = "2026-06-08-note.md";
const OTHER = "2026-06-09-other.md";
const NOTE_DOC = `learning:${NOTE}`;
const SESSION_DOC = `session:${SESSION_ID}`;

let learningsDir: string;
let brainDir: string;

// One prompt, an assistant turn that writes the note learning, a closing reply.
const events = [
  { type: "ai-title", aiTitle: "Wire the brain sweep" },
  {
    type: "user",
    cwd: "/Users/x/Projects/dayboard",
    timestamp: "2026-06-08T10:00:00.000Z",
    message: { role: "user", content: "Build the brain feature." },
  },
  {
    type: "assistant",
    timestamp: "2026-06-08T10:05:00.000Z",
    message: {
      model: "claude-opus-4-8",
      usage: { input_tokens: 10, output_tokens: 20 },
      content: [
        { type: "tool_use", name: "Write", input: { file_path: `/Users/x/Projects/learnings/${NOTE}` } },
        { type: "text", text: "Done." },
      ],
    },
  },
];

async function settle(job: BrainSweepJob): Promise<void> {
  const start = Date.now();
  while (job.status === "running") {
    if (Date.now() - start > 5000) throw new Error("brain sweep did not settle");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function run(opts?: { force?: boolean }): Promise<BrainSweepJob> {
  const job = sweep.startBrainSweep(opts);
  await settle(job);
  return job;
}

beforeAll(async () => {
  learningsDir = mkdtempSync(join(tmpdir(), "dayboard-bsweep-learnings-"));
  writeFileSync(join(learningsDir, NOTE), "# Brain sweep notes\n\nbody");
  writeFileSync(join(learningsDir, OTHER), "# Other research\n\nbody");

  const projectsDir = mkdtempSync(join(tmpdir(), "dayboard-bsweep-proj-"));
  mkdirSync(join(projectsDir, "-Users-x-Projects-dayboard"));
  writeFileSync(
    join(projectsDir, "-Users-x-Projects-dayboard", `${SESSION_ID}.jsonl`),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  // A dashboard-routine transcript (the brain narrating itself): agent-origin
  // + a routine-signature prompt. Must be invisible to the Brain.
  writeFileSync(
    join(projectsDir, "-Users-x-Projects-dayboard", `${ROUTINE_ID}.jsonl`),
    [
      { type: "ai-title", aiTitle: "Analyze knowledge graph" },
      {
        type: "user",
        entrypoint: "sdk-cli",
        promptSource: "sdk",
        cwd: "/Users/x/Projects/dayboard",
        timestamp: "2026-06-08T11:00:00.000Z",
        message: { role: "user", content: "You are the analyst of Sam's personal knowledge graph. Read the work file…" },
      },
      { type: "assistant", timestamp: "2026-06-08T11:01:00.000Z", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "{}" }] } },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n",
  );

  brainDir = mkdtempSync(join(tmpdir(), "dayboard-bsweep-brain-"));
  process.env.LEARNINGS_DIR = learningsDir;
  process.env.CLAUDE_PROJECTS_DIR = projectsDir;
  process.env.CLAUDE_SESSIONS_DIR = mkdtempSync(join(tmpdir(), "dayboard-bsweep-sess-"));
  process.env.DAYBOARD_BRAIN_DIR = brainDir;
  process.env.BRAIN_BATCH_SIZE = "2"; // 3 docs -> 2 batches

  // A real, controllable `claude` stand-in (claude.ts captures the bin at
  // import, so it must be set before the import below). It always exits
  // non-zero — a generic error by default (the "failed"/"unreachable" paths),
  // or a usage-limit notice on STDOUT when DAYBOARD_STUB_USAGE_LIMIT is set
  // (the deferral path). Honors `claude -p`'s trailing prompt arg.
  const stub = join(brainDir, "claude-stub.sh");
  writeFileSync(
    stub,
    [
      "#!/bin/sh",
      'if [ -n "$DAYBOARD_STUB_USAGE_LIMIT" ]; then',
      '  echo "Claude usage limit reached. Your limit will reset at 9pm."',
      "  exit 1",
      "fi",
      'echo "stub failure" 1>&2',
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(stub, 0o755);
  process.env.SWEEP_CLAUDE_BIN = stub;

  sweep = await import("./brain-sweep.ts");
  brain = await import("./brain.ts");
  store = await import("./brain-store.ts");
});

describe("brain sweep (mocked, end to end)", () => {
  it("indexes every learning + session in batches, and reuses an active job", async () => {
    const job = sweep.startBrainSweep();
    expect(sweep.startBrainSweep().id).toBe(job.id); // already running -> same job
    await settle(job);

    expect(job).toMatchObject({
      status: "done",
      total: 3,
      done: 3,
      batches: 2,
      batch: 2,
      topicTotal: 1, // mock-topic gained members this run -> queued once
      topicsSummarized: 1, // ...and finished
      synthesizing: false, // settled after the discoveries pass
      verifyTotal: 1, // the fresh mock discovery arrived pending
      verified: 1,
      newTopics: 1, // mock-topic created once, reused in batch 2
      newLinks: 1, // the session -> note artifact link
      newDiscoveries: 1, // the mock discovery, first seen this run
      error: null,
    });
    expect(job.topicsSummarized).toBe(job.topicTotal);
  });

  it("synthesizes a discovery over the whole graph and persists it", () => {
    const { discoveries } = JSON.parse(readFileSync(join(brainDir, "discoveries.json"), "utf8"));
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]).toMatchObject({
      id: "mock-discovery",
      kind: "thread",
      title: "Mock discovery",
      topics: ["mock-topic"],
      docs: [`learning:${OTHER}`, NOTE_DOC], // first two digest docs (learnings list newest first)
      status: "active",
    });
    expect(discoveries[0].firstSeen).toBe(discoveries[0].lastSeen);
  });

  it("verifies the fresh hypothesis: status done, mock verdict + evidence persisted", () => {
    const { discoveries } = JSON.parse(readFileSync(join(brainDir, "discoveries.json"), "utf8"));
    expect(discoveries[0].verification).toMatchObject({ status: "done", verdict: "confirmed" });
    expect(discoveries[0].verification.checkedAt).toBeTruthy();
    expect(discoveries[0].verification.evidence).toEqual([
      expect.objectContaining({ source: "slack", supports: true }),
      expect.objectContaining({ source: "linear", supports: false }),
    ]);

    // First check: the work file carried the hypothesis + internal evidence,
    // and no prior research to build on.
    const work = JSON.parse(
      readFileSync(join(brainDir, "work", "verify-mock-discovery.json"), "utf8"),
    );
    expect(work.hypothesis).toMatchObject({ id: "mock-discovery", kind: "thread" });
    expect(work.internalEvidence).toHaveLength(2);
    expect(work.priorVerification).toBeNull();
  });

  it("writes one connections file per doc plus the topic registry", () => {
    expect(readdirSync(join(brainDir, "connections")).sort()).toEqual([
      "learning--2026-06-08-note.json",
      "learning--2026-06-09-other.json",
      `session--${SESSION_ID}.json`,
    ]);
    const topics = JSON.parse(readFileSync(join(brainDir, "topics.json"), "utf8"));
    expect(topics.topics).toHaveLength(1);
    expect(topics.topics[0]).toMatchObject({ slug: "mock-topic", label: "Mock Topic", description: "" });
  });

  it("writes a topic key-findings summary derived from its members + a fingerprint", () => {
    const { topics } = JSON.parse(readFileSync(join(brainDir, "topics.json"), "utf8"));
    const [mock] = topics;
    // The mock reply derives the summary from the topic LABEL, proving the
    // work file carried it through the prompt.
    expect(mock.summary).toBe("Key findings for Mock Topic: a mock synthesis across its member docs.");
    expect(mock.summaryFingerprint).not.toBe("");
    // The work file held the topic plus every member doc, each with the
    // excerpt the indexing pass anchored to this slug.
    const work = JSON.parse(readFileSync(join(brainDir, "work", "topic-mock-topic.json"), "utf8"));
    expect(work.topic).toMatchObject({ slug: "mock-topic", label: "Mock Topic" });
    expect(work.docs).toHaveLength(3);
    expect(work.docs[0]).toHaveProperty("excerpt");
  });

  it("surfaces the topic summary on the graph (getBrainGraph spread)", () => {
    const t = brain.getBrainGraph().topics.find((t) => t.slug === "mock-topic");
    expect(t?.summary).toBe("Key findings for Mock Topic: a mock synthesis across its member docs.");
  });

  it("never indexes, graphs, or counts the dashboard's own routine sessions", () => {
    expect(existsSync(join(brainDir, "connections", `session--${ROUTINE_ID}.json`))).toBe(false);
    const g = brain.getBrainGraph();
    expect(g.docs.map((d) => d.id)).not.toContain(`session:${ROUTINE_ID}`);
    expect(g.unindexed).toBe(0); // the routine transcript must not peg this above zero
  });

  it("records the session→learning artifact link symmetrically", () => {
    const link = { id: NOTE_DOC, reason: "This session wrote the doc.", origin: "artifact" };
    expect(store.readConnections(SESSION_DOC)?.linksTo).toEqual([link]);
    expect(store.readConnections(NOTE_DOC)?.linkedFrom).toEqual([
      { ...link, id: SESSION_DOC },
    ]);
    expect(store.readConnections(SESSION_DOC)).toMatchObject({
      kind: "session",
      title: "Wire the brain sweep",
      date: "2026-06-08",
      summary: "Mock summary for Wire the brain sweep.",
    });
  });

  it("aggregates the swept files into the graph", () => {
    const g = brain.getBrainGraph();
    expect(g.docs).toHaveLength(3);
    expect(g.unindexed).toBe(0);
    expect(g.links).toEqual([
      {
        from: SESSION_DOC,
        to: NOTE_DOC,
        reason: "This session wrote the doc.",
        origin: "artifact",
      },
    ]);
    expect(g.sweptAt).not.toBeNull();
    expect(g.topics).toHaveLength(1);
    expect(g.topics[0]).toMatchObject({ slug: "mock-topic", label: "Mock Topic", description: "", docCount: 3 });
  });

  it("skips everything on the next run — nothing stale, topics, synthesis and verification included", async () => {
    const before = readFileSync(join(brainDir, "discoveries.json"), "utf8");
    const topicsBefore = readFileSync(join(brainDir, "topics.json"), "utf8");
    const job = await run();
    expect(job).toMatchObject({
      status: "done", total: 0, done: 0, batches: 0, newDiscoveries: 0,
      topicTotal: 0, topicsSummarized: 0, // fingerprint unchanged -> nothing to re-summarize
      verifyTotal: 0, verified: 0, // already done — nothing pending to research
    });
    expect(sweep.getBrainSweep()?.id).toBe(job.id); // latest job, any status
    // Synthesis didn't run: the file is byte-identical (no lastSeen bump).
    expect(readFileSync(join(brainDir, "discoveries.json"), "utf8")).toBe(before);
    // The topic summary is byte-identical too — no wasted call rewrote it.
    expect(readFileSync(join(brainDir, "topics.json"), "utf8")).toBe(topicsBefore);
  });

  it("re-indexes only docs whose source changed, evolving the discovery (not re-creating it)", async () => {
    const before = JSON.parse(readFileSync(join(brainDir, "discoveries.json"), "utf8"))
      .discoveries[0];
    const fpBefore = JSON.parse(readFileSync(join(brainDir, "topics.json"), "utf8"))
      .topics[0].summaryFingerprint;
    const future = new Date(Date.now() + 10_000);
    utimesSync(join(learningsDir, OTHER), future, future);
    const job = await run();
    expect(job.total).toBe(1);
    expect(job.done).toBe(1);
    expect(job.newDiscoveries).toBe(0); // same id = update, not new

    const after = JSON.parse(readFileSync(join(brainDir, "discoveries.json"), "utf8"))
      .discoveries[0];
    expect(after.firstSeen).toBe(before.firstSeen);
    expect(after.lastSeen > before.lastSeen).toBe(true);

    // OTHER is in mock-topic, so its re-index advances the member fingerprint
    // and the topic re-summarizes.
    expect(job).toMatchObject({ topicTotal: 1, topicsSummarized: 1 });
    const fpAfter = JSON.parse(readFileSync(join(brainDir, "topics.json"), "utf8"))
      .topics[0].summaryFingerprint;
    expect(fpAfter).not.toBe(fpBefore);
  });

  it("honors BRAIN_SWEEP_LIMIT, and force re-indexes everything", async () => {
    process.env.BRAIN_SWEEP_LIMIT = "1";
    try {
      expect((await run({ force: true })).total).toBe(1);
    } finally {
      delete process.env.BRAIN_SWEEP_LIMIT;
    }
    expect((await run({ force: true })).total).toBe(3);
  });

  it("force runs synthesis even when nothing was indexed", async () => {
    const before = readFileSync(join(brainDir, "discoveries.json"), "utf8");
    process.env.BRAIN_SWEEP_LIMIT = "0"; // slices the work to nothing
    try {
      const job = await run({ force: true });
      expect(job).toMatchObject({ status: "done", total: 0, newDiscoveries: 0 });
      // Synthesis ran: lastSeen bumped, so the file changed.
      expect(readFileSync(join(brainDir, "discoveries.json"), "utf8")).not.toBe(before);
    } finally {
      delete process.env.BRAIN_SWEEP_LIMIT;
    }
  });

  it("deletes connections whose source vanished and scrubs links to them", async () => {
    rmSync(join(learningsDir, NOTE));
    await run();
    expect(existsSync(join(brainDir, "connections", "learning--2026-06-08-note.json"))).toBe(false);
    expect(store.readConnections(SESSION_DOC)?.linksTo).toEqual([]);
    expect(brain.getBrainGraph().docs.map((d) => d.id).sort()).toEqual(
      [`learning:${OTHER}`, SESSION_DOC].sort(),
    );
    // A removal-only sweep still re-synthesizes, so discovery evidence sheds
    // the deleted doc immediately rather than waiting for the next indexing.
    const cited = store.readDiscoveries().flatMap((d) => d.docs);
    expect(cited.length).toBeGreaterThan(0);
    expect(cited).not.toContain(NOTE_DOC);
  });

  it("creates artifact links only once the writing session itself is swept", async () => {
    // Fresh graph with all sources present: a BRAIN_SWEEP_LIMIT that covers
    // only the learnings must leave the session→learning link uncreated; it
    // appears when a later, uncapped run reaches the session.
    writeFileSync(join(learningsDir, NOTE), "# Brain sweep notes\n\nbody");
    rmSync(join(brainDir, "connections"), { recursive: true, force: true });
    rmSync(join(brainDir, "topics.json"), { force: true });

    process.env.BRAIN_SWEEP_LIMIT = "2";
    try {
      expect((await run()).total).toBe(2); // learnings come first; the session is beyond the cap
    } finally {
      delete process.env.BRAIN_SWEEP_LIMIT;
    }
    expect(store.readConnections(SESSION_DOC)).toBeNull();
    expect(store.readConnections(NOTE_DOC)?.linkedFrom).toEqual([]);

    expect((await run()).total).toBe(1); // just the session now
    const link = { id: NOTE_DOC, reason: "This session wrote the doc.", origin: "artifact" };
    expect(store.readConnections(SESSION_DOC)?.linksTo).toEqual([link]);
    expect(store.readConnections(NOTE_DOC)?.linkedFrom).toEqual([
      { ...link, id: SESSION_DOC },
    ]);
  });

  it("fails the job (not the process) when claude is unreachable, keeping prior batches", async () => {
    delete process.env.SWEEP_MOCK; // real exec hits the bogus test binary
    try {
      const job = await run({ force: true });
      expect(job.status).toBe("error");
      expect(job.error).toBeTruthy();
      expect(job.synthesizing).toBe(false);
      // Work persisted by earlier runs stands untouched.
      expect(store.readConnections(SESSION_DOC)).not.toBeNull();
      expect(store.readConnections(`learning:${OTHER}`)).not.toBeNull();
      expect(store.readDiscoveries()).toHaveLength(1);
    } finally {
      process.env.SWEEP_MOCK = "1";
    }
  });
});

// Order-dependent like the suite above: starts from one active, already-done
// discovery and a fully indexed graph.
describe("brain sweep — external verification", () => {
  it("re-queues when the insight text changes, and researches fresh (no prior hand-off)", async () => {
    // Doctor the stored insight so the (unchanged) mock synthesis reply reads
    // as a moved hypothesis; touch a doc so synthesis actually runs.
    store.writeDiscoveries(
      store.readDiscoveries().map((d) => ({ ...d, insight: "Doctored stale hypothesis." })),
    );
    const future = new Date(Date.now() + 30_000);
    utimesSync(join(learningsDir, OTHER), future, future);

    const job = await run();
    expect(job).toMatchObject({ status: "done", verifyTotal: 1, verified: 1 });
    expect(store.readDiscoveries()[0].verification).toMatchObject({
      status: "done",
      verdict: "confirmed",
    });
    // The reset wiped the old research, so none was handed to the researcher.
    const work = JSON.parse(
      readFileSync(join(brainDir, "work", "verify-mock-discovery.json"), "utf8"),
    );
    expect(work.priorVerification).toBeNull();
  });

  it("force re-verifies an already-done hypothesis, handing over the prior research", async () => {
    process.env.BRAIN_SWEEP_LIMIT = "0"; // verification only — no re-indexing noise
    try {
      expect(await run({ force: true })).toMatchObject({ verifyTotal: 1, verified: 1 });
    } finally {
      delete process.env.BRAIN_SWEEP_LIMIT;
    }
    const work = JSON.parse(
      readFileSync(join(brainDir, "work", "verify-mock-discovery.json"), "utf8"),
    );
    expect(work.priorVerification).toMatchObject({ verdict: "confirmed" });
    expect(work.priorVerification.evidence).toHaveLength(2);
  });

  it("honors SWEEP_VERIFY_LIMIT; the next run picks up the remainder without indexing", async () => {
    const [first] = store.readDiscoveries();
    store.writeDiscoveries([
      { ...first, verification: PENDING_VERIFICATION },
      { ...first, id: "second-hypothesis", title: "Second", verification: PENDING_VERIFICATION },
    ]);

    process.env.SWEEP_VERIFY_LIMIT = "1";
    try {
      expect(await run()).toMatchObject({ status: "done", verifyTotal: 1, verified: 1 });
    } finally {
      delete process.env.SWEEP_VERIFY_LIMIT;
    }
    expect(store.readDiscoveries().map((d) => d.verification.status).sort()).toEqual([
      "done",
      "pending",
    ]);

    expect(await run()).toMatchObject({ status: "done", total: 0, verifyTotal: 1, verified: 1 });
    expect(store.readDiscoveries().every((d) => d.verification.status === "done")).toBe(true);
  });

  it("marks a failed research run on its record and continues — the job still completes", async () => {
    store.writeDiscoveries(
      store.readDiscoveries().map((d) => ({ ...d, verification: PENDING_VERIFICATION })),
    );
    // Nothing is stale, so the ONLY claude calls this run are the two research
    // runs — both hit the bogus test binary and fail.
    delete process.env.SWEEP_MOCK;
    try {
      const job = await run();
      expect(job).toMatchObject({ status: "done", verifyTotal: 2, verified: 2, error: null });
    } finally {
      process.env.SWEEP_MOCK = "1";
    }
    for (const d of store.readDiscoveries()) {
      expect(d.verification.status).toBe("failed");
      expect(d.verification.verdict).toBeNull();
      expect(d.verification.detail).toBeTruthy();
      expect(d.verification.checkedAt).toBeTruthy();
    }
  });

  it("defers (not fails) a research run that hits the usage limit; the job still completes", async () => {
    store.writeDiscoveries(
      store.readDiscoveries().map((d) => ({ ...d, verification: PENDING_VERIFICATION })),
    );
    const pending = store.readDiscoveries().length;
    delete process.env.SWEEP_MOCK; // real exec -> the usage-limit stub
    process.env.DAYBOARD_STUB_USAGE_LIMIT = "1";
    try {
      const job = await run();
      expect(job).toMatchObject({
        status: "done",
        verifyTotal: pending,
        verified: pending,
        verifyDeferred: pending,
        error: null,
      });
    } finally {
      delete process.env.DAYBOARD_STUB_USAGE_LIMIT;
      process.env.SWEEP_MOCK = "1";
    }
    for (const d of store.readDiscoveries()) {
      expect(d.verification.status).toBe("deferred");
      expect(d.verification.verdict).toBeNull();
      expect(d.verification.checkedAt).toBeNull();
      expect(d.verification.detail).toContain("usage limit");
    }
  });

  it("re-queues a deferred hypothesis on the next sweep just like a pending one", async () => {
    // Left "deferred" by the previous test; an unforced run (nothing stale)
    // must still pick it up, and the mock now resolves it to done.
    expect(store.readDiscoveries().every((d) => d.verification.status === "deferred")).toBe(true);
    const queued = store.readDiscoveries().length;
    const job = await run();
    expect(job).toMatchObject({ status: "done", total: 0, verifyTotal: queued, verifyDeferred: 0 });
    expect(store.readDiscoveries().every((d) => d.verification.status === "done")).toBe(true);
  });
});

// Last, because it doctors the topic registry: a topic whose every member is
// gone must have its summary cleared to "" — with NO claude call.
describe("brain sweep — topic summaries", () => {
  it("clears the summary of a topic that lost all its members, with no claude call", async () => {
    // No connection references "orphan-topic", so its membership is empty.
    store.writeTopics([
      ...store.readTopics(),
      { slug: "orphan-topic", label: "Orphan", description: "", summary: "Stale summary.", summaryFingerprint: "old-fp" },
    ]);
    rmSync(join(brainDir, "work", "topic-orphan-topic.json"), { force: true });

    process.env.BRAIN_SWEEP_LIMIT = "0"; // index nothing — exercise only the topic pass
    try {
      const job = await run();
      // The empty topic is cleared without a call, so it never enters the queue.
      expect(job.topicTotal).toBe(0);
    } finally {
      delete process.env.BRAIN_SWEEP_LIMIT;
    }

    const orphan = store.readTopics().find((t) => t.slug === "orphan-topic")!;
    expect(orphan.summary).toBe("");
    expect(orphan.summaryFingerprint).toBe("");
    // No work file was written for it -> the LLM was never invoked.
    expect(existsSync(join(brainDir, "work", "topic-orphan-topic.json"))).toBe(false);
  });
});
