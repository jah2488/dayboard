import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { isUsageLimitError, runClaude as runClaudeBin } from "./claude.ts";
import { getConfig, resolveRoutinePrompt } from "./config.ts";
import { getLearning, listLearnings } from "./learnings.ts";
import { getSession, listBrainSessions } from "./sessions.ts";
import {
  connectionsPath,
  deleteConnections,
  readAllConnections,
  readConnections,
  readDiscoveries,
  readTopics,
  writeConnections,
  writeDiscoveries,
  writeTopics,
  writeWorkFile,
} from "./brain-store.ts";
import { applyBatch, parseBatchReply, removeDoc } from "./brain-merge.ts";
import type { ArtifactLink, DocMeta, MergeState } from "./brain-merge.ts";
import {
  applyVerification,
  mergeDiscoveries,
  parseSynthesisReply,
  parseVerificationReply,
} from "./brain-discover.ts";
import {
  applyTopicSummary,
  parseTopicSummaryReply,
  topicFingerprint,
} from "./brain-topic.ts";
import type {
  BrainConnections,
  BrainDiscovery,
  BrainSweepJob,
  BrainTopic,
  BrainVerificationStatus,
  LearningDoc,
  SessionListItem,
  SessionOrigin,
} from "../shared/types.ts";

// The four brain prompts resolve through config.ts (override -> committed
// template, with {{identity.*}} rendered; the brain's own {{WORK_FILE}}
// placeholder is left intact for the per-call substitution below).

const LEARNING_CONTENT_MAX = 6000;
const SESSION_TEXT_MAX = 1500;

// In-memory job registry, same shape as sweep.ts — single-user local app.
const jobs = new Map<string, BrainSweepJob>();

interface LearningDigest {
  id: string;
  kind: "learning";
  title: string;
  date: string | null;
  origin: SessionOrigin;
  content: string;
}

interface SessionDigest {
  id: string;
  kind: "session";
  title: string;
  project: string;
  date: string | null;
  origin: SessionOrigin;
  goal: string;
  results: string;
  tools: string;
  prs: string[];
  wroteLearnings: string[];
}

interface WorkItem {
  id: string;
  meta: DocMeta;
  digest: LearningDigest | SessionDigest;
  artifacts: ArtifactLink[];
}

// SWEEP_MOCK=1 short-circuits with a canned reply derived from the work file
// just written, so tests exercise the full write→prompt→merge→persist pipeline
// deterministically; otherwise delegate to the shared headless runner.
function runClaude(
  prompt: string,
  workFile: string,
  mock: (workFile: string) => string,
  timeoutMs?: number,
  model?: string,
): Promise<string> {
  if (process.env.SWEEP_MOCK === "1") return Promise.resolve(mock(workFile));
  return runClaudeBin(prompt, undefined, timeoutMs, model);
}

// Background sweeps must NOT inherit the user's interactive default (often
// Opus) — a sweep fires ~one call per indexed doc plus synthesis + a
// verification per hypothesis, which on a top tier drains daily usage fast.
// Indexing is mechanical extraction (cheap tier); synthesis + verification need
// judgment and tool use (mid tier). Both config-driven (models.tag /
// models.reason), with the legacy env knobs still overriding.
const indexModel = () => process.env.SWEEP_INDEX_MODEL ?? getConfig().models.tag;
const reasonModel = () => process.env.SWEEP_REASON_MODEL ?? getConfig().models.reason;

// Synthesis reasons over the whole graph in one call — it legitimately needs
// far longer than a 10-doc indexing batch (the first real run blew the 5-min
// default).
const SYNTHESIS_TIMEOUT_MS = Number(
  process.env.SWEEP_SYNTHESIS_TIMEOUT_MS ?? 900_000,
);
// Verification roams several external systems per hypothesis — same generous
// ceiling as synthesis, per call.
const VERIFY_TIMEOUT_MS = Number(process.env.SWEEP_VERIFY_TIMEOUT_MS ?? 900_000);
// A topic summary reasons over every member doc in one call — same generous
// per-call ceiling as synthesis and verification.
const TOPIC_TIMEOUT_MS = Number(process.env.SWEEP_TOPIC_TIMEOUT_MS ?? 900_000);

// A crash mid-research strands records on "running" with no process behind
// them; on boot, put those hypotheses back in the queue.
const stranded = readDiscoveries();
if (stranded.some((d) => d.status === "active" && d.verification.status === "running")) {
  writeDiscoveries(
    stranded.map((d) =>
      d.status === "active" && d.verification.status === "running"
        ? { ...d, verification: { ...d.verification, status: "pending" } }
        : d,
    ),
  );
}

function mockReply(workFile: string): string {
  const work = JSON.parse(readFileSync(workFile, "utf8")) as {
    docs: Array<{ id: string; title: string }>;
  };
  return JSON.stringify({
    docs: work.docs.map((d) => ({
      id: d.id,
      summary: `Mock summary for ${d.title}.`,
      topics: [{ slug: "mock-topic", label: "Mock Topic", strength: 0.5, excerpt: null }],
      links: [],
    })),
  });
}

function mockVerifyReply(workFile: string): string {
  const work = JSON.parse(readFileSync(workFile, "utf8")) as {
    hypothesis: { id: string; title: string };
  };
  return JSON.stringify({
    verdict: "confirmed",
    detail: `## Method\nMock research for ${work.hypothesis.title}.\n\n## Findings\nMock findings.\n\n## Conclusion\nConfirmed.`,
    evidence: [
      {
        source: "slack",
        summary: `Mock Slack thread substantiating ${work.hypothesis.id}.`,
        ref: "https://example.slack.com/archives/MOCK/p1",
        supports: true,
      },
      {
        source: "linear",
        summary: "Mock Linear ticket contradicting one edge of the claim.",
        ref: "ENG-0000",
        supports: false,
      },
    ],
  });
}

function mockSynthesisReply(workFile: string): string {
  const work = JSON.parse(readFileSync(workFile, "utf8")) as {
    topics: Array<{ slug: string }>;
    docs: Array<{ id: string }>;
  };
  return JSON.stringify({
    discoveries: [
      {
        id: "mock-discovery",
        kind: "thread",
        title: "Mock discovery",
        insight: "A mock thread across the first two docs.",
        topics: work.topics.slice(0, 1).map((t) => t.slug),
        docs: work.docs.slice(0, 2).map((d) => d.id),
      },
    ],
  });
}

function mockTopicReply(workFile: string): string {
  const work = JSON.parse(readFileSync(workFile, "utf8")) as {
    topic: { label: string };
  };
  return JSON.stringify({
    summary: `Key findings for ${work.topic.label}: a mock synthesis across its member docs.`,
  });
}

function learningWork(l: LearningDoc): WorkItem {
  const id = `learning:${l.file}`;
  // Learnings are the user's own writing, never agent chatter.
  const origin: SessionOrigin = "direct";
  return {
    id,
    meta: { kind: "learning", title: l.title, date: l.date, origin, sourceMtime: l.mtime },
    digest: {
      id,
      kind: "learning",
      title: l.title,
      date: l.date,
      origin,
      content: (getLearning(l.file)?.content ?? "").slice(0, LEARNING_CONTENT_MAX),
    },
    artifacts: [],
  };
}

function sessionWork(s: SessionListItem): WorkItem {
  const id = `session:${s.id}`;
  const d = getSession(s.id)!;
  // d.learnings resolves titles against the docs that still exist — a non-null
  // title means the learning file is real, so the artifact link can't dangle.
  const wrote = d.learnings.filter((l) => l.title !== null).map((l) => `learning:${l.file}`);
  return {
    id,
    meta: { kind: "session", title: d.title, date: d.startedAt?.slice(0, 10) ?? null, origin: d.origin, sourceMtime: d.mtime },
    digest: {
      id,
      kind: "session",
      title: d.title,
      project: d.project,
      date: d.startedAt?.slice(0, 10) ?? null,
      origin: d.origin,
      goal: d.goal.slice(0, SESSION_TEXT_MAX),
      results: d.results.slice(0, SESSION_TEXT_MAX),
      tools: d.stats.toolCalls.byName.slice(0, 8).map((t) => `${t.name}×${t.count}`).join(", "),
      prs: d.prs.map((p) => `${p.repository}#${p.number}`),
      wroteLearnings: wrote,
    },
    // A session that wrote a doc is deterministic ground truth, no AI judgment.
    artifacts: wrote.map((to) => ({ from: id, to, reason: "This session wrote the doc." })),
  };
}

function persistChanged(
  before: Map<string, BrainConnections>,
  after: Map<string, BrainConnections>,
): void {
  for (const [id, conn] of after) {
    if (before.get(id) !== conn) writeConnections(conn);
  }
}

// Drop connections whose source is no longer brain-eligible, scrubbing every
// reference to them both directions. Quota-free (no LLM). Shared by the sweep
// and the standalone cleanup so the retraction rule lives in exactly one place.
function pruneVanished(
  state: MergeState,
  present: Set<string>,
): { state: MergeState; removed: number } {
  const vanished = [...state.connections.keys()].filter((id) => !present.has(id));
  for (const id of vanished) {
    const next = removeDoc(state, id);
    persistChanged(state.connections, next.connections);
    deleteConnections(id);
    state = next;
  }
  return { state, removed: vanished.length };
}

// Standalone, quota-free cleanup — no LLM, no full sweep. Run after eligibility
// rules change (e.g. agent/subagent sessions excluded from indexing) to drop
// their now-ineligible connections immediately instead of waiting for a sweep.
export function pruneIneligibleConnections(): number {
  const state: MergeState = {
    connections: new Map(readAllConnections().map((c) => [c.id, c])),
    topics: readTopics(),
  };
  const present = new Set([
    ...listLearnings().map((l) => `learning:${l.file}`),
    ...listBrainSessions().map((s) => `session:${s.id}`),
  ]);
  return pruneVanished(state, present).removed;
}

async function execute(job: BrainSweepJob, force: boolean): Promise<void> {
  let state: MergeState = {
    connections: new Map(readAllConnections().map((c) => [c.id, c])),
    topics: readTopics(),
  };
  const learnings = listLearnings();
  // Brain-eligible sessions only: the dashboard's own routine transcripts are
  // excluded everywhere (candidates AND the present set), so their stale
  // connections get cleaned up as "vanished" and never re-index.
  const sessions = listBrainSessions();

  // Sources that vanished take their connections — and every reference to
  // them — along. Includes running sessions (so a live one doesn't look
  // deleted) but not machinery (excluded from listBrainSessions).
  const present = new Set([
    ...learnings.map((l) => `learning:${l.file}`),
    ...sessions.map((s) => `session:${s.id}`),
  ]);
  const pruned = pruneVanished(state, present);
  state = pruned.state;
  const vanished = pruned.removed;

  // Strictly < : equal mtime means unchanged. (<= would re-index every doc on
  // every sweep; the cost is that a sub-millisecond double edit waits for the
  // next touch — inherent to mtime-based detection, and self-healing.)
  const stale = (id: string, mtime: number) =>
    force || (state.connections.get(id)?.sourceMtime ?? -1) < mtime;
  // connectionsPath also screens out the rare source whose name can't map to a
  // storage file — indexing it would just fail at write time, every run.
  const lite = [
    ...learnings
      .filter((l) => connectionsPath(`learning:${l.file}`) && stale(`learning:${l.file}`, l.mtime))
      .map((l) => ({ kind: "learning" as const, l })),
    ...sessions
      .filter((s) => !s.running && stale(`session:${s.id}`, s.mtime))
      .map((s) => ({ kind: "session" as const, s })),
  ].slice(0, process.env.BRAIN_SWEEP_LIMIT ? Number(process.env.BRAIN_SWEEP_LIMIT) : Infinity);
  const work = lite.map((w) => (w.kind === "learning" ? learningWork(w.l) : sessionWork(w.s)));

  const batchSize = Math.max(1, Number(process.env.BRAIN_BATCH_SIZE ?? 10));
  job.total = work.length;
  job.batches = Math.ceil(work.length / batchSize);
  const promptTemplate = resolveRoutinePrompt("brain-sweep").rendered;

  for (let n = 1; n <= job.batches; n++) {
    job.batch = n;
    const slice = work.slice((n - 1) * batchSize, n * batchSize);

    const workFile = writeWorkFile(`batch-${n}`, {
      topics: state.topics,
      knownDocs: [...state.connections.values()].map((c) => ({
        id: c.id,
        kind: c.kind,
        title: c.title,
        topics: c.topics.map((t) => t.slug),
      })),
      docs: slice.map((w) => w.digest),
    });
    const reply = await runClaude(
      promptTemplate.replace("{{WORK_FILE}}", workFile), workFile, mockReply, undefined, indexModel(),
    );
    const batch = parseBatchReply(reply);

    const result = applyBatch(
      state,
      batch,
      new Map(slice.map((w) => [w.id, w.meta])),
      slice.flatMap((w) => w.artifacts),
      new Date().toISOString(),
    );

    // Persist after every batch — a later failure must not lose earlier work;
    // the next run simply resumes the remainder.
    persistChanged(state.connections, result.connections);
    writeTopics(result.topics);
    state = { connections: result.connections, topics: result.topics };

    job.done += slice.length;
    job.newTopics += result.newTopics;
    job.newLinks += result.newLinks;
  }

  // Topic summaries: run AFTER indexing (membership is final) and BEFORE
  // synthesis. Each topic's summary is refreshed only when its member set
  // drifted, so an unchanged topic never costs a call.
  state = { ...state, topics: await summarizeTopics(state, job, force) };

  // Synthesis: one extra pass over the WHOLE graph for cross-document
  // discoveries — only when this run changed something (indexed OR removed,
  // so evidence lists shed deleted docs promptly; or force), since an
  // unchanged graph is what the last synthesis already saw. A failure here
  // fails the job, but every batch above is already persisted.
  if (work.length > 0 || vanished > 0 || force) {
    job.synthesizing = true;
    try {
      job.newDiscoveries = await synthesize(state);
    } finally {
      job.synthesizing = false;
    }
  }

  // Verification: research the hypotheses still awaiting it — even on a run
  // that indexed nothing, so remainders from a capped run get picked up.
  // Sequentially (machine kindness: one claude pipeline, not a fan-out);
  // force re-queues everything because the outside world moves on its own.
  const verifyLimit = process.env.SWEEP_VERIFY_LIMIT
    ? Number(process.env.SWEEP_VERIFY_LIMIT)
    : Infinity;
  // A "deferred" hypothesis (paused last run on the usage limit) re-queues
  // exactly like "pending" — mid-flight work the world hasn't answered yet.
  const requeue = (status: BrainVerificationStatus) =>
    status === "pending" || status === "deferred";
  const queue = readDiscoveries()
    .filter((d) => d.status === "active" && (force || requeue(d.verification.status)))
    .map((d) => d.id)
    .slice(0, verifyLimit);
  job.verifyTotal = queue.length;
  for (const id of queue) {
    const v = verifyOne(id);
    // A failed/deferred run lands on its own record, never on the job — and an
    // id a concurrent route call grabbed first just counts as handled.
    if (v.status === "started") {
      const settled = await v.settled;
      if (settled.verification.status === "deferred") job.verifyDeferred += 1;
    }
    job.verified += 1;
  }

  job.status = "done";
}

// A topic's membership is every connection whose topics include its slug —
// computed from the records after indexing, so a doc that belongs to several
// topics contributes to each of their summaries.
function topicMembers(
  connections: MergeState["connections"],
  slug: string,
): Array<{ id: string; indexedAt: string }> {
  return [...connections.values()]
    .filter((c) => c.topics.some((t) => t.slug === slug))
    .map((c) => ({ id: c.id, indexedAt: c.indexedAt }));
}

// Refresh each topic's key-findings summary, but only where it's actually
// stale: an empty topic gets its summary cleared (no call), an unchanged one
// keeps its summary verbatim, and a drifted one is re-summarized. Persists the
// registry after every topic so a mid-run failure keeps the finished ones.
async function summarizeTopics(
  state: MergeState,
  job: BrainSweepJob,
  force: boolean,
): Promise<BrainTopic[]> {
  const topicLimit = process.env.SWEEP_TOPIC_LIMIT
    ? Number(process.env.SWEEP_TOPIC_LIMIT)
    : Infinity;

  // First pass, no calls: clear summaries for topics that lost all members.
  let topics = state.topics.map((t) => {
    const empty = topicMembers(state.connections, t.slug).length === 0;
    return empty && (t.summary || t.summaryFingerprint)
      ? applyTopicSummary(t, "", "")
      : t;
  });
  if (topics.some((t, i) => t !== state.topics[i])) writeTopics(topics);

  // Queue the non-empty topics whose member fingerprint drifted (or force).
  const queue = topics
    .map((t) => ({ topic: t, fingerprint: topicFingerprint(topicMembers(state.connections, t.slug)) }))
    .filter(
      ({ topic, fingerprint }) =>
        fingerprint !== "" && (force || fingerprint !== topic.summaryFingerprint),
    )
    .slice(0, topicLimit);
  job.topicTotal = queue.length;

  const template = resolveRoutinePrompt("brain-topic").rendered;
  for (const { topic, fingerprint } of queue) {
    try {
      const workFile = writeWorkFile(`topic-${topic.slug}`, {
        topic: { slug: topic.slug, label: topic.label, description: topic.description },
        docs: [...state.connections.values()]
          .filter((c) => c.topics.some((t) => t.slug === topic.slug))
          .map((c) => ({
            id: c.id,
            kind: c.kind,
            title: c.title,
            date: c.date,
            summary: c.summary,
            // The excerpt the indexing pass anchored to THIS topic — the part
            // of that doc the summary should lean on.
            excerpt: c.topics.find((t) => t.slug === topic.slug)?.excerpt ?? null,
          })),
      });
      const reply = await runClaude(
        template.replace("{{WORK_FILE}}", workFile),
        workFile,
        mockTopicReply,
        TOPIC_TIMEOUT_MS,
        reasonModel(),
      );
      const summarized = applyTopicSummary(topic, parseTopicSummaryReply(reply).summary, fingerprint);
      topics = topics.map((t) => (t.slug === topic.slug ? summarized : t));
      writeTopics(topics); // incremental durability, like the batch loop
      job.topicsSummarized += 1;
    } catch (e) {
      // One topic's failure must not fail the sweep (mirrors a contained
      // verification failure): leave its old summary and move on.
      console.error(`brain topic summary failed for ${topic.slug}:`, e);
    }
  }

  return topics;
}

async function synthesize(state: MergeState): Promise<number> {
  const existing = readDiscoveries();
  const all = [...state.connections.values()];
  const docCounts = all
    .flatMap((c) => c.topics.map((t) => t.slug))
    .reduce((m, slug) => m.set(slug, (m.get(slug) ?? 0) + 1), new Map<string, number>());

  const workFile = writeWorkFile("synthesis", {
    topics: state.topics.map((t) => ({
      slug: t.slug,
      label: t.label,
      docCount: docCounts.get(t.slug) ?? 0,
    })),
    docs: all.map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      date: c.date,
      summary: c.summary,
      topics: c.topics.map((t) => t.slug),
    })),
    links: all.flatMap((c) =>
      c.linksTo.map((l) => ({ from: c.id, to: l.id, reason: l.reason })),
    ),
    discoveries: existing.filter((d) => d.status === "active"),
    dismissed: existing
      .filter((d) => d.status === "dismissed")
      .map((d) => ({ id: d.id, title: d.title })),
  });

  const template = resolveRoutinePrompt("brain-discoveries").rendered;
  const reply = await runClaude(
    template.replace("{{WORK_FILE}}", workFile),
    workFile,
    mockSynthesisReply,
    SYNTHESIS_TIMEOUT_MS,
    reasonModel(),
  );
  const merged = mergeDiscoveries(
    existing,
    parseSynthesisReply(reply),
    new Set(state.connections.keys()),
    new Set(state.topics.map((t) => t.slug)),
    new Date().toISOString(),
  );
  writeDiscoveries(merged.discoveries);
  return merged.newDiscoveries;
}

// One research run in flight per discovery — the sweep loop and the HTTP
// route share this guard, so the second asker gets a conflict.
const verifying = new Set<string>();

export type VerifyOutcome =
  | { status: "unknown" }
  | { status: "conflict" }
  | { status: "started"; record: BrainDiscovery; settled: Promise<BrainDiscovery> };

// Flip one discovery to "running" and persist it (the UI shows it live), then
// research the hypothesis. The flip happens synchronously so the route can
// answer with the running record immediately; `settled` resolves once the
// outcome — done or failed — is on disk.
export function verifyOne(id: string): VerifyOutcome {
  const all = readDiscoveries();
  const hit = all.find((d) => d.id === id && d.status === "active");
  if (!hit) return { status: "unknown" };
  if (verifying.has(id) || hit.verification.status === "running") return { status: "conflict" };

  verifying.add(id);
  const record: BrainDiscovery = {
    ...hit,
    verification: { ...hit.verification, status: "running" },
  };
  writeDiscoveries(all.map((d) => (d.id === id ? record : d)));
  return { status: "started", record, settled: research(record) };
}

async function research(record: BrainDiscovery): Promise<BrainDiscovery> {
  let next: BrainDiscovery;
  try {
    const workFile = writeWorkFile(`verify-${record.id}`, {
      hypothesis: {
        id: record.id,
        kind: record.kind,
        title: record.title,
        insight: record.insight,
        topics: record.topics,
      },
      internalEvidence: record.docs.map((docId) => {
        const conn = readConnections(docId);
        return {
          id: docId,
          kind: conn?.kind ?? null,
          title: conn?.title ?? docId,
          date: conn?.date ?? null,
          summary: conn?.summary ?? "",
          excerpts: (conn?.topics ?? [])
            .filter((t) => record.topics.includes(t.slug) && t.excerpt)
            .map((t) => ({ topic: t.slug, excerpt: t.excerpt })),
        };
      }),
      // On a re-check, hand the researcher its previous conclusions to build
      // on; checkedAt is the tell that research actually ran before.
      priorVerification: record.verification.checkedAt
        ? {
            verdict: record.verification.verdict,
            detail: record.verification.detail,
            evidence: record.verification.evidence,
            checkedAt: record.verification.checkedAt,
          }
        : null,
    });
    const template = resolveRoutinePrompt("brain-verify").rendered;
    const reply = await runClaude(
      template.replace("{{WORK_FILE}}", workFile),
      workFile,
      mockVerifyReply,
      VERIFY_TIMEOUT_MS,
      reasonModel(),
    );
    next = applyVerification(record, parseVerificationReply(reply), new Date().toISOString());
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e);
    // A usage-limit abort is a soft pause, not a result: leave verdict/checkedAt
    // null and re-queue (deferred is treated like pending next sweep). Any other
    // error is a real failure and lands as one.
    next = isUsageLimitError(message)
      ? {
          ...record,
          verification: {
            status: "deferred",
            verdict: null,
            detail: "Deferred: Claude usage limit — will retry next sweep.",
            evidence: [],
            checkedAt: null,
          },
        }
      : {
          ...record,
          verification: {
            status: "failed",
            verdict: null,
            detail: message,
            evidence: [],
            checkedAt: new Date().toISOString(),
          },
        };
  }
  verifying.delete(record.id);

  // Re-read before writing: a dismissal or another record's verification may
  // have touched the file while this research ran. Only land on a record
  // that's still active — dismissals and retirements win over stale results.
  writeDiscoveries(
    readDiscoveries().map((d) => (d.id === next.id && d.status === "active" ? next : d)),
  );
  return next;
}

export function startBrainSweep(opts: { force?: boolean } = {}): BrainSweepJob {
  const active = [...jobs.values()].find((j) => j.status === "running");
  if (active) return active;

  const job: BrainSweepJob = {
    id: randomUUID(),
    status: "running",
    startedAt: new Date().toISOString(),
    total: 0,
    done: 0,
    batches: 0,
    batch: 0,
    topicTotal: 0,
    topicsSummarized: 0,
    synthesizing: false,
    verifyTotal: 0,
    verified: 0,
    verifyDeferred: 0,
    newTopics: 0,
    newLinks: 0,
    newDiscoveries: 0,
    error: null,
  };
  jobs.set(job.id, job);
  execute(job, opts.force ?? false).catch((e) => {
    job.status = "error";
    job.error = String(e instanceof Error ? e.message : e);
  });
  return job;
}

// Latest job regardless of status — the UI shows the last outcome, not just
// in-flight work.
export function getBrainSweep(): BrainSweepJob | null {
  return [...jobs.values()].at(-1) ?? null;
}
