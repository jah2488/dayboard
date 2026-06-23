import { describe, expect, it } from "vitest";
import {
  PENDING_VERIFICATION,
  applyVerification,
  mergeDiscoveries,
  parseSynthesisReply,
  parseVerificationReply,
} from "./brain-discover.ts";
import type { SynthesisReply, VerificationReply } from "./brain-discover.ts";
import type { BrainDiscovery, BrainVerification } from "../shared/types.ts";

const NOW = "2026-06-11T08:00:00.000Z";
const EARLIER = "2026-06-01T08:00:00.000Z";

const A = "learning:a.md";
const B = "learning:b.md";
const C = "session:cccc-1111";
const DOC_IDS = new Set([A, B, C]);
const TOPIC_SLUGS = new Set(["project-alpha", "mcp"]);

const disc = (id: string, over: Partial<BrainDiscovery> = {}): BrainDiscovery => ({
  id,
  kind: "thread",
  title: `Title of ${id}`,
  insight: "Old insight.",
  topics: ["project-alpha"],
  docs: [A, B],
  status: "active",
  hidden: false,
  firstSeen: EARLIER,
  lastSeen: EARLIER,
  verification: PENDING_VERIFICATION,
  ...over,
});

const DONE: BrainVerification = {
  status: "done",
  verdict: "confirmed",
  detail: "## Method\nChecked Slack.",
  evidence: [{ source: "slack", summary: "A thread.", ref: "https://slack/x", supports: true }],
  checkedAt: "2026-06-05T08:00:00.000Z",
};

type Entry = SynthesisReply["discoveries"][number];
const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id,
  kind: "thread",
  title: `Title of ${id}`,
  insight: "New insight.",
  topics: ["project-alpha"],
  docs: [A, B],
  ...over,
});

const merge = (existing: BrainDiscovery[], entries: Entry[]) =>
  mergeDiscoveries(existing, { discoveries: entries }, DOC_IDS, TOPIC_SLUGS, NOW);

describe("mergeDiscoveries — new and updated", () => {
  it("creates a new discovery stamped firstSeen = lastSeen = now", () => {
    const r = merge([], [entry("fresh")]);
    expect(r.newDiscoveries).toBe(1);
    expect(r.discoveries).toEqual([
      {
        id: "fresh",
        kind: "thread",
        title: "Title of fresh",
        insight: "New insight.",
        topics: ["project-alpha"],
        docs: [A, B],
        status: "active",
        hidden: false,
        firstSeen: NOW,
        lastSeen: NOW,
        verification: PENDING_VERIFICATION,
      },
    ]);
  });

  it("updates a matched id: firstSeen preserved, lastSeen bumped, substance replaced", () => {
    const r = merge(
      [disc("known", { kind: "thread", topics: ["project-alpha"], docs: [A, B] })],
      [entry("known", { kind: "trend", title: "Evolved", insight: "Evolved insight.", topics: ["mcp"], docs: [B, C] })],
    );
    expect(r.newDiscoveries).toBe(0);
    expect(r.discoveries[0]).toMatchObject({
      id: "known",
      kind: "trend",
      title: "Evolved",
      insight: "Evolved insight.",
      topics: ["mcp"],
      docs: [B, C],
      firstSeen: EARLIER,
      lastSeen: NOW,
    });
  });

  it("counts only ids that did not exist before", () => {
    const r = merge([disc("known")], [entry("known"), entry("brand-new")]);
    expect(r.newDiscoveries).toBe(1);
  });

  it("retires active discoveries the reply omits", () => {
    const r = merge([disc("stale"), disc("kept")], [entry("kept")]);
    expect(r.discoveries.map((d) => d.id)).toEqual(["kept"]);
  });

  it("defaults new records to hidden:false and preserves a prior hidden across updates", () => {
    expect(merge([], [entry("fresh")]).discoveries[0].hidden).toBe(false);
    const r = merge([disc("kept", { hidden: true })], [entry("kept", { title: "Retitled" })]);
    expect(r.discoveries[0].hidden).toBe(true);
  });

  it("kebab-normalizes ids, matching existing records through the normalization", () => {
    const r = merge([disc("mock-discovery")], [entry("  Mock Discovery! ")]);
    expect(r.newDiscoveries).toBe(0);
    expect(r.discoveries[0]).toMatchObject({ id: "mock-discovery", firstSeen: EARLIER });
  });

  it("drops entries whose id normalizes to nothing, and duplicate ids (first wins)", () => {
    const r = merge([], [entry("!!!"), entry("dupe", { title: "first" }), entry("DUPE", { title: "second" })]);
    expect(r.discoveries).toHaveLength(1);
    expect(r.discoveries[0]).toMatchObject({ id: "dupe", title: "first" });
  });
});

describe("mergeDiscoveries — tombstones", () => {
  it("drops reply entries matching a dismissed id and passes the tombstone through untouched", () => {
    const tomb = disc("buried", { status: "dismissed" });
    const r = merge([tomb], [entry("buried", { title: "resurrection attempt" })]);
    expect(r.newDiscoveries).toBe(0);
    expect(r.discoveries).toEqual([tomb]);
    expect(r.discoveries[0]).toBe(tomb); // untouched, not a rebuilt copy
  });

  it("keeps tombstones even when the reply is empty", () => {
    const tomb = disc("buried", { status: "dismissed" });
    expect(merge([tomb, disc("active-one")], []).discoveries).toEqual([tomb]);
  });
});

describe("mergeDiscoveries — evidence and topics", () => {
  it("filters docs to validDocIds, dedupes, and caps at 8", () => {
    const many = new Set(Array.from({ length: 12 }, (_, i) => `learning:doc-${i}.md`));
    const r = mergeDiscoveries(
      [],
      { discoveries: [entry("big", { docs: ["learning:fake.md", "learning:doc-0.md", ...many, ...many] })] },
      many,
      TOPIC_SLUGS,
      NOW,
    );
    expect(r.discoveries[0].docs).toHaveLength(8);
    expect(r.discoveries[0].docs).not.toContain("learning:fake.md");
  });

  it("drops a discovery left with fewer than 2 surviving evidence docs", () => {
    const r = merge([], [entry("thin", { docs: [A, "learning:gone.md"] }), entry("solid")]);
    expect(r.discoveries.map((d) => d.id)).toEqual(["solid"]);
    expect(r.newDiscoveries).toBe(1);
  });

  it("filters topics to validTopicSlugs and caps at 5", () => {
    const slugs = new Set(["t1", "t2", "t3", "t4", "t5", "t6"]);
    const r = mergeDiscoveries(
      [],
      { discoveries: [entry("topical", { topics: ["nope", "t1", "t2", "t3", "t4", "t5", "t6"] })] },
      DOC_IDS,
      slugs,
      NOW,
    );
    expect(r.discoveries[0].topics).toEqual(["t1", "t2", "t3", "t4", "t5"]);
  });

  it("trims and caps title at 90 and insight at 600", () => {
    const r = merge([], [entry("long", { title: ` ${"t".repeat(200)} `, insight: "i".repeat(700) })]);
    expect(r.discoveries[0].title).toBe("t".repeat(90));
    expect(r.discoveries[0].insight).toBe("i".repeat(600));
  });

  it("caps the active set at 12", () => {
    const r = merge([], Array.from({ length: 15 }, (_, i) => entry(`d-${i}`)));
    expect(r.discoveries).toHaveLength(12);
    expect(r.newDiscoveries).toBe(12);
  });

  it("reserves room for a cross-cutting kind so a flood of threads can't evict it", () => {
    // 12 threads (enough to fill the cap on their own) plus one correlation
    // listed LAST. Recency ties (all stamped NOW), so without the reservation
    // the correlation would be sliced off behind the threads.
    const flood = Array.from({ length: 12 }, (_, i) => entry(`thread-${i}`));
    const r = merge([], [...flood, entry("corr", { kind: "correlation" })]);
    expect(r.discoveries).toHaveLength(12);
    const corr = r.discoveries.find((d) => d.id === "corr");
    expect(corr?.kind).toBe("correlation");
    // it took a slot from the oldest-ranked thread, not the other way round
    expect(r.discoveries.filter((d) => d.kind === "thread")).toHaveLength(11);
  });
});

describe("mergeDiscoveries — verification lifecycle", () => {
  it("preserves the previous verification by identity when the insight is unchanged", () => {
    const prev = disc("kept", { insight: "Same insight.", verification: DONE });
    const r = merge([prev], [entry("kept", { title: "Retitled", insight: "Same insight." })]);
    expect(r.discoveries[0].verification).toBe(DONE);
  });

  it("resets to pending when the insight text changes — the hypothesis moved", () => {
    const prev = disc("moved", { insight: "Old insight.", verification: DONE });
    const r = merge([prev], [entry("moved", { insight: "New insight." })]);
    expect(r.discoveries[0].verification).toEqual(PENDING_VERIFICATION);
  });

  it("preserves a mid-flight 'deferred' verification across an unchanged-insight update", () => {
    const deferred: BrainVerification = {
      status: "deferred",
      verdict: null,
      detail: "Deferred: Claude usage limit — will retry next sweep.",
      evidence: [],
      checkedAt: null,
    };
    const prev = disc("paused", { insight: "Same insight.", verification: deferred });
    const r = merge([prev], [entry("paused", { title: "Retitled", insight: "Same insight." })]);
    expect(r.discoveries[0].verification).toBe(deferred);
  });

  it("compares insights post-trim/post-cap, so cosmetic overflow is not a change", () => {
    const long = "i".repeat(700);
    const prev = disc("capped", { insight: long.slice(0, 600), verification: DONE });
    const r = merge([prev], [entry("capped", { insight: ` ${long} ` })]);
    expect(r.discoveries[0].verification).toBe(DONE);
  });

  it("leaves a dismissed record's verification untouched", () => {
    const tomb = disc("buried", { status: "dismissed", verification: DONE });
    expect(merge([tomb], [entry("buried")]).discoveries[0].verification).toBe(DONE);
  });
});

describe("applyVerification", () => {
  it("lands a done verification with normalized sources and null-coalesced refs", () => {
    const reply: VerificationReply = {
      verdict: "partial",
      detail: "  ## Method\nChecked things.  ",
      evidence: [
        { source: "Slack Search!", summary: " Found a thread. ", ref: "https://x", supports: true },
        { source: "LINEAR", summary: "Ticket closed.", supports: false },
      ],
    };
    const d = applyVerification(disc("x"), reply, NOW);
    expect(d).toMatchObject({ id: "x", insight: "Old insight." }); // record substance untouched
    expect(d.verification).toEqual({
      status: "done",
      verdict: "partial",
      detail: "## Method\nChecked things.",
      evidence: [
        { source: "slack-search", summary: "Found a thread.", ref: "https://x", supports: true },
        { source: "linear", summary: "Ticket closed.", ref: null, supports: false },
      ],
      checkedAt: NOW,
    });
  });

  it("caps detail at 4000, evidence at 10 items, and summaries at 300", () => {
    const d = applyVerification(
      disc("x"),
      {
        verdict: "confirmed",
        detail: "d".repeat(5000),
        evidence: Array.from({ length: 12 }, (_, i) => ({
          source: "github",
          summary: "s".repeat(400),
          ref: `#${i}`,
          supports: i % 2 === 0,
        })),
      },
      NOW,
    );
    expect(d.verification.detail).toHaveLength(4000);
    expect(d.verification.evidence).toHaveLength(10);
    expect(d.verification.evidence[0].summary).toHaveLength(300);
  });
});

describe("parseVerificationReply", () => {
  it("extracts the JSON object from surrounding prose/fences and validates it", () => {
    const reply =
      'Sure:\n```json\n{"verdict":"refuted","detail":"d","evidence":[{"source":"linear","summary":"s","supports":false}]}\n```';
    expect(parseVerificationReply(reply)).toEqual({
      verdict: "refuted",
      detail: "d",
      evidence: [{ source: "linear", summary: "s", supports: false }],
    });
  });

  it("rejects replies with no JSON object, an unknown verdict, or evidence without supports", () => {
    expect(() => parseVerificationReply("nope")).toThrow(/No JSON object/);
    expect(() => parseVerificationReply('{"verdict":"maybe","detail":"d"}')).toThrow();
    expect(() =>
      parseVerificationReply(
        '{"verdict":"confirmed","detail":"d","evidence":[{"source":"slack","summary":"s"}]}',
      ),
    ).toThrow();
  });
});

describe("parseSynthesisReply", () => {
  it("extracts the JSON object from surrounding prose/fences and validates it", () => {
    const reply =
      '```json\n{"discoveries":[{"id":"x","kind":"fix","title":"t","insight":"i"}]}\n```';
    expect(parseSynthesisReply(reply).discoveries[0]).toEqual({
      id: "x",
      kind: "fix",
      title: "t",
      insight: "i",
      topics: [],
      docs: [],
    });
  });

  it("accepts the cross-cutting kinds (correlation, contradiction, silence)", () => {
    for (const kind of ["correlation", "contradiction", "silence"] as const) {
      const reply = `{"discoveries":[{"id":"x","kind":"${kind}","title":"t","insight":"i"}]}`;
      expect(parseSynthesisReply(reply).discoveries[0].kind).toBe(kind);
    }
  });

  it("rejects replies with no JSON object or an unknown kind", () => {
    expect(() => parseSynthesisReply("nope")).toThrow(/No JSON object/);
    expect(() =>
      parseSynthesisReply('{"discoveries":[{"id":"x","kind":"vibe","title":"t","insight":"i"}]}'),
    ).toThrow();
  });
});
