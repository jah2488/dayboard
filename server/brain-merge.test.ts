import { describe, expect, it } from "vitest";
import {
  applyBatch,
  parseBatchReply,
  removeDoc,
} from "./brain-merge.ts";
import type { ArtifactLink, BatchReply, DocMeta, MergeState } from "./brain-merge.ts";
import type { BrainConnections, BrainTopic } from "../shared/types.ts";

const NOW = "2026-06-11T08:00:00.000Z";

// A registered topic. registerTopics coins new ones unsummarized (summary +
// fingerprint ""), so that's the default the assertions compare against.
const topic = (over: Partial<BrainTopic> & { slug: string }): BrainTopic => ({
  label: over.slug,
  description: "",
  summary: "",
  summaryFingerprint: "",
  ...over,
});

const conn = (id: string, over: Partial<BrainConnections> = {}): BrainConnections => ({
  id,
  kind: id.startsWith("learning:") ? "learning" : "session",
  title: id,
  date: null,
  summary: "old summary",
  origin: id.startsWith("learning:") ? "direct" : "agent",
  topics: [],
  linksTo: [],
  linkedFrom: [],
  sourceMtime: 1,
  indexedAt: "2026-06-10T00:00:00.000Z",
  ...over,
});

const state = (conns: BrainConnections[], topics: MergeState["topics"] = []): MergeState => ({
  connections: new Map(conns.map((c) => [c.id, c])),
  topics,
});

const metaFor = (...ids: string[]): Map<string, DocMeta> =>
  new Map(
    ids.map((id) => [
      id,
      {
        kind: id.startsWith("learning:") ? ("learning" as const) : ("session" as const),
        title: `Title of ${id}`,
        date: "2026-06-09",
        origin: id.startsWith("learning:") ? ("direct" as const) : ("agent" as const),
        sourceMtime: 2,
      },
    ]),
  );

const batch = (docs: Array<Partial<BatchReply["docs"][number]> & { id: string }>): BatchReply => ({
  docs: docs.map((d) => ({ summary: "s", date: null, topics: [], links: [], ...d })),
});

const A = "learning:a.md";
const B = "learning:b.md";
const C = "session:cccc-1111";

const apply = (
  s: MergeState,
  b: BatchReply,
  meta: Map<string, DocMeta>,
  artifacts: ArtifactLink[] = [],
) => applyBatch(s, b, meta, artifacts, NOW);

describe("applyBatch — records", () => {
  it("builds a connections record from meta + AI output", () => {
    const r = apply(state([]), batch([{ id: A, summary: " gist ", date: "2026-06-08" }]), metaFor(A));
    expect(r.connections.get(A)).toEqual({
      id: A,
      kind: "learning",
      title: `Title of ${A}`,
      date: "2026-06-08", // AI date wins over meta when present
      summary: "gist",
      origin: "direct", // carried from meta
      topics: [],
      linksTo: [],
      linkedFrom: [],
      sourceMtime: 2,
      indexedAt: NOW,
    });
  });

  it("falls back to meta date and drops docs the model invented", () => {
    const r = apply(state([]), batch([{ id: A }, { id: "learning:made-up.md" }]), metaFor(A));
    expect(r.connections.get(A)?.date).toBe("2026-06-09");
    expect(r.connections.has("learning:made-up.md")).toBe(false);
  });

  it("carries the doc's origin onto the record — agent for a session", () => {
    const r = apply(state([]), batch([{ id: C }]), metaFor(C));
    expect(r.connections.get(C)?.origin).toBe("agent");
  });
});

describe("applyBatch — topics", () => {
  it("registers unknown slugs, normalized to kebab-case, with humanized fallback label", () => {
    const r = apply(
      state([]),
      batch([
        {
          id: A,
          topics: [
            { slug: "Edge Functions!", strength: 0.7 },
            { slug: "project-alpha", label: "Project Alpha", description: "The Project Alpha partner", strength: 0.9 },
          ],
        },
      ]),
      metaFor(A),
    );
    expect(r.newTopics).toBe(2);
    expect(r.topics).toEqual([
      topic({ slug: "edge-functions", label: "Edge Functions" }),
      topic({ slug: "project-alpha", label: "Project Alpha", description: "The Project Alpha partner" }),
    ]);
    expect(r.connections.get(A)?.topics.map((t) => t.slug)).toEqual(["project-alpha", "edge-functions"]);
  });

  it("reuses the existing canon — registry entry untouched, no newTopics", () => {
    // A non-empty summary + fingerprint proves re-indexing a doc into an
    // existing topic preserves the summary the topic-pass already wrote.
    const canon = [
      topic({ slug: "project-alpha", label: "Project Alpha (partner)", description: "canon", summary: "Prior summary.", summaryFingerprint: "fp" }),
    ];
    const r = apply(
      state([], canon),
      batch([{ id: A, topics: [{ slug: "PROJECT-ALPHA", label: "other label", strength: 1 }] }]),
      metaFor(A),
    );
    expect(r.newTopics).toBe(0);
    expect(r.topics).toEqual(canon);
  });

  it("clamps strength to [0,1], caps at 6 by strength, truncates excerpts to 240", () => {
    const topics = [
      { slug: "t-strong", strength: 7, excerpt: "x".repeat(500) },
      { slug: "t-negative", strength: -1 },
      ...[1, 2, 3, 4, 5].map((n) => ({ slug: `t-${n}`, strength: n / 10 })),
    ];
    const r = apply(state([]), batch([{ id: A, topics }]), metaFor(A));
    const refs = r.connections.get(A)!.topics;
    expect(refs).toHaveLength(6);
    expect(refs[0]).toEqual({ slug: "t-strong", strength: 1, excerpt: "x".repeat(240) });
    expect(refs.map((t) => t.slug)).not.toContain("t-negative"); // clamped to 0, weakest of 7
  });

  it("dedupes topic refs that normalize to the same slug, keeping the stronger", () => {
    const r = apply(
      state([]),
      batch([{ id: A, topics: [{ slug: "Mcp", strength: 0.2 }, { slug: "mcp", strength: 0.8 }] }]),
      metaFor(A),
    );
    expect(r.connections.get(A)?.topics).toEqual([{ slug: "mcp", strength: 0.8, excerpt: null }]);
    expect(r.newTopics).toBe(1);
  });
});

describe("applyBatch — links", () => {
  it("mirrors a link onto the target: linksTo on the source, linkedFrom on the target", () => {
    const r = apply(
      state([]),
      batch([{ id: A, links: [{ id: B, reason: "same workstream" }] }, { id: B }]),
      metaFor(A, B),
    );
    expect(r.newLinks).toBe(1);
    expect(r.connections.get(A)?.linksTo).toEqual([
      { id: B, reason: "same workstream", origin: "ai" },
    ]);
    expect(r.connections.get(B)?.linkedFrom).toEqual([
      { id: A, reason: "same workstream", origin: "ai" },
    ]);
  });

  it("links to an already-indexed doc outside the batch, preserving its other fields", () => {
    const existing = conn(B, { summary: "kept" });
    const r = apply(state([existing]), batch([{ id: A, links: [{ id: B, reason: "r" }] }]), metaFor(A));
    expect(r.connections.get(B)?.linkedFrom).toEqual([{ id: A, reason: "r", origin: "ai" }]);
    expect(r.connections.get(B)?.summary).toBe("kept");
  });

  it("drops self-links, unknown targets, and duplicates; truncates reasons to 160", () => {
    const r = apply(
      state([]),
      batch([
        {
          id: A,
          links: [
            { id: A, reason: "self" },
            { id: "learning:nowhere.md", reason: "unknown" },
            { id: B, reason: "y".repeat(300) },
            { id: B, reason: "dupe" },
          ],
        },
        { id: B },
      ]),
      metaFor(A, B),
    );
    expect(r.connections.get(A)?.linksTo).toEqual([
      { id: B, reason: "y".repeat(160), origin: "ai" },
    ]);
    expect(r.newLinks).toBe(1);
  });

  it("applies artifact links with origin 'artifact', beating an AI duplicate of the same pair", () => {
    const r = apply(
      state([]),
      batch([{ id: C, links: [{ id: A, reason: "ai version" }] }, { id: A }]),
      metaFor(A, C),
      [{ from: C, to: A, reason: "This session wrote the doc." }],
    );
    expect(r.connections.get(C)?.linksTo).toEqual([
      { id: A, reason: "This session wrote the doc.", origin: "artifact" },
    ]);
    expect(r.connections.get(A)?.linkedFrom).toEqual([
      { id: C, reason: "This session wrote the doc.", origin: "artifact" },
    ]);
    expect(r.newLinks).toBe(1);
  });

  it("applies artifact links even when the model returned nothing for the doc", () => {
    const r = apply(state([conn(A)]), batch([{ id: C }]), metaFor(C), [
      { from: C, to: A, reason: "This session wrote the doc." },
    ]);
    expect(r.connections.get(C)?.linksTo.map((l) => l.id)).toEqual([A]);
  });
});

describe("applyBatch — re-indexing", () => {
  const indexed = () =>
    state([
      conn(A, { linksTo: [{ id: B, reason: "old", origin: "ai" }] }),
      conn(B, { linkedFrom: [{ id: A, reason: "old", origin: "ai" }] }),
      conn(C),
    ]);

  it("retracts previous outbound links from every target before applying the new set", () => {
    const r = apply(indexed(), batch([{ id: A, links: [{ id: C, reason: "new" }] }]), metaFor(A));
    expect(r.connections.get(A)?.linksTo.map((l) => l.id)).toEqual([C]);
    expect(r.connections.get(B)?.linkedFrom).toEqual([]);
    expect(r.connections.get(C)?.linkedFrom.map((l) => l.id)).toEqual([A]);
  });

  it("counts only genuinely new pairs in newLinks", () => {
    const same = apply(indexed(), batch([{ id: A, links: [{ id: B, reason: "still" }] }]), metaFor(A));
    expect(same.newLinks).toBe(0);
    expect(same.connections.get(B)?.linkedFrom.map((l) => l.reason)).toEqual(["still"]);
  });

  it("retracts stale linkedFrom even when source and target are re-indexed together", () => {
    const r = apply(indexed(), batch([{ id: A }, { id: B }]), metaFor(A, B));
    expect(r.connections.get(B)?.linkedFrom).toEqual([]);
  });

  it("preserves inbound links from docs outside the batch", () => {
    const r = apply(indexed(), batch([{ id: B, summary: "fresh" }]), metaFor(B));
    expect(r.connections.get(B)?.linkedFrom).toEqual([{ id: A, reason: "old", origin: "ai" }]);
    expect(r.connections.get(B)?.summary).toBe("fresh");
  });

  it("keeps object identity for untouched records (the shell persists by identity)", () => {
    const s = indexed();
    const untouched = s.connections.get(C)!;
    const r = apply(s, batch([{ id: B }]), metaFor(B));
    expect(r.connections.get(C)).toBe(untouched);
    expect(r.connections.get(B)).not.toBe(s.connections.get(B));
  });
});

describe("removeDoc", () => {
  it("drops the record and scrubs references to it in both directions", () => {
    const s = state([
      conn(A, { linksTo: [{ id: B, reason: "r", origin: "ai" }] }),
      conn(B, {
        linkedFrom: [{ id: A, reason: "r", origin: "ai" }],
        linksTo: [{ id: A, reason: "back", origin: "ai" }],
      }),
      conn(C),
    ]);
    const untouched = s.connections.get(C)!;
    const r = removeDoc(s, A);
    expect(r.connections.has(A)).toBe(false);
    expect(r.connections.get(B)?.linkedFrom).toEqual([]);
    expect(r.connections.get(B)?.linksTo).toEqual([]);
    expect(r.connections.get(C)).toBe(untouched);
    expect(r.topics).toBe(s.topics);
  });
});

describe("parseBatchReply", () => {
  it("extracts the JSON object from surrounding prose/fences and validates it", () => {
    const reply = '```json\n{"docs":[{"id":"learning:a.md","summary":"s"}]}\n```';
    expect(parseBatchReply(reply).docs[0]).toMatchObject({ id: A, topics: [], links: [] });
  });

  it("rejects replies with no JSON object or the wrong shape", () => {
    expect(() => parseBatchReply("nope")).toThrow(/No JSON object/);
    expect(() => parseBatchReply('{"docs":[{"id":1}]}')).toThrow();
  });
});
