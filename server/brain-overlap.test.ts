import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOverlapPayload, surfaceOverlap } from "./brain-overlap.ts";
import type { BrainConnections, BrainGraph, BrainTopic } from "../shared/types.ts";

// Stage a tmp brain dir + mock claude BEFORE importing brain-store/api so the
// store and the overlap endpoint read this scratch graph.
process.env.DAYBOARD_BRAIN_DIR = mkdtempSync(join(tmpdir(), "dayboard-overlap-"));
process.env.SWEEP_MOCK = "1";
let store: typeof import("./brain-store.ts");
let api: typeof import("./api.ts").api;

const topic = (slug: string): BrainTopic => ({ slug, label: slug.toUpperCase(), description: "", summary: "", summaryFingerprint: "" });
const conn = (id: string, slugs: string[]): BrainConnections => ({
  id,
  kind: id.startsWith("learning:") ? "learning" : "session",
  title: id,
  date: null,
  summary: "s",
  origin: "direct",
  topics: slugs.map((slug) => ({ slug, strength: 1, excerpt: null })),
  linksTo: [],
  linkedFrom: [],
  sourceMtime: 1,
  indexedAt: "2026-06-01T00:00:00.000Z",
});

beforeAll(async () => {
  store = await import("./brain-store.ts");
  api = (await import("./api.ts")).api;
  store.writeTopics([topic("alpha"), topic("beta")]);
  store.writeConnections(conn("learning:a.md", ["alpha"]));
  store.writeConnections(conn("learning:b.md", ["alpha", "beta"])); // bridge
});

// Minimal graph: docs A (alpha), B (alpha+beta = bridge), C (beta), D (gamma,
// off-topic), plus a missing doc and a few links.
const graph = (): BrainGraph => ({
  docs: [
    { id: "learning:a.md", kind: "learning", title: "A", summary: "a", date: null, origin: "direct", topics: [{ slug: "alpha", strength: 1, excerpt: null }], missing: false },
    { id: "learning:b.md", kind: "learning", title: "B", summary: "b", date: null, origin: "direct", topics: [{ slug: "alpha", strength: 1, excerpt: null }, { slug: "beta", strength: 1, excerpt: null }], missing: false },
    { id: "session:c", kind: "session", title: "C", summary: "c", date: null, origin: "direct", topics: [{ slug: "beta", strength: 1, excerpt: null }], missing: false },
    { id: "learning:d.md", kind: "learning", title: "D", summary: "d", date: null, origin: "direct", topics: [{ slug: "gamma", strength: 1, excerpt: null }], missing: false },
    { id: "learning:gone.md", kind: "learning", title: "gone", summary: "", date: null, origin: "direct", topics: [{ slug: "alpha", strength: 1, excerpt: null }], missing: true },
  ],
  topics: [
    { slug: "alpha", label: "Alpha", description: "", summary: "", summaryFingerprint: "", docCount: 2 },
    { slug: "beta", label: "Beta", description: "", summary: "", summaryFingerprint: "", docCount: 2 },
    { slug: "gamma", label: "Gamma", description: "", summary: "", summaryFingerprint: "", docCount: 1 },
  ],
  links: [
    { from: "learning:a.md", to: "session:c", reason: "a-c", origin: "ai" }, // both members
    { from: "learning:a.md", to: "learning:d.md", reason: "a-d", origin: "ai" }, // d off-topic
  ],
  sweptAt: null,
  unindexed: 0,
  hidden: { docs: [], topics: [] },
});

describe("buildOverlapPayload", () => {
  it("keeps only the selected topics and their (non-missing) member docs", () => {
    const p = buildOverlapPayload(graph(), ["alpha", "beta"]);
    expect(p.topics.map((t) => t.slug)).toEqual(["alpha", "beta"]);
    // A, B, C are members; D is gamma-only; gone.md is missing -> excluded
    expect(p.docs.map((d) => d.id).sort()).toEqual(["learning:a.md", "learning:b.md", "session:c"]);
  });

  it("marks a doc in both topics as a bridge (belongsTo length > 1)", () => {
    const p = buildOverlapPayload(graph(), ["alpha", "beta"]);
    const bridge = p.docs.find((d) => d.id === "learning:b.md");
    expect(bridge?.belongsTo.sort()).toEqual(["alpha", "beta"]);
  });

  it("keeps only links whose endpoints are both member docs", () => {
    const p = buildOverlapPayload(graph(), ["alpha", "beta"]);
    // a-c kept (both members); a-d dropped (d is off-topic)
    expect(p.links).toEqual([{ from: "learning:a.md", to: "session:c", reason: "a-c" }]);
  });
});

describe("surfaceOverlap guards", () => {
  it("rejects fewer than two distinct topics", async () => {
    await expect(surfaceOverlap(["alpha"])).rejects.toThrow(/at least two/);
    await expect(surfaceOverlap(["alpha", "alpha"])).rejects.toThrow(/at least two/);
  });
});

describe("POST /api/brain/overlap", () => {
  const post = (topics: unknown) =>
    api.request("/brain/overlap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics }),
    });

  it("400s on fewer than two topics", async () => {
    expect((await post(["alpha"])).status).toBe(400);
  });

  it("returns a mock overlap summary for two real topics", async () => {
    const res = await post(["alpha", "beta"]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { topics: { slug: string }[]; markdown: string };
    expect(body.topics.map((t) => t.slug)).toEqual(["alpha", "beta"]);
    expect(body.markdown).toMatch(/Verdict|Bridges/);
  });
});
