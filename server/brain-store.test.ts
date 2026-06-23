import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { BrainDiscovery, BrainVerification } from "../shared/types.ts";

// brain-store resolves its dir at import time — stage the tmp dir first and
// import lazily (same pattern as the other brain tests).
let store: typeof import("./brain-store.ts");
let brainDir: string;

const record = (over: Partial<BrainDiscovery> = {}) => ({
  id: "old-one",
  kind: "thread",
  title: "An old discovery",
  insight: "Predates verification.",
  topics: [],
  docs: ["learning:a.md", "learning:b.md"],
  status: "active",
  firstSeen: "2026-06-01T08:00:00.000Z",
  lastSeen: "2026-06-01T08:00:00.000Z",
  ...over,
});

const file = (discoveries: unknown[]) =>
  writeFileSync(join(brainDir, "discoveries.json"), JSON.stringify({ discoveries }));

beforeAll(async () => {
  brainDir = mkdtempSync(join(tmpdir(), "dayboard-bstore-"));
  process.env.DAYBOARD_BRAIN_DIR = brainDir;
  store = await import("./brain-store.ts");
});

describe("readDiscoveries — verification normalization", () => {
  it("normalizes records written before the verification feature to pending", () => {
    file([record()]); // no verification field at all
    expect(store.readDiscoveries()[0].verification).toEqual({
      status: "pending",
      verdict: null,
      detail: "",
      evidence: [],
      checkedAt: null,
    });
  });

  it("defaults a missing hidden flag to false, and keeps an explicit one", () => {
    file([record(), record({ id: "tucked", hidden: true })]);
    const byId = Object.fromEntries(store.readDiscoveries().map((d) => [d.id, d.hidden]));
    expect(byId).toEqual({ "old-one": false, tucked: true });
  });

  it("passes records that already carry a verification through verbatim", () => {
    const verification: BrainVerification = {
      status: "done",
      verdict: "refuted",
      detail: "## Method\nLooked.",
      evidence: [{ source: "github", summary: "PR merged.", ref: "#1", supports: false }],
      checkedAt: "2026-06-10T08:00:00.000Z",
    };
    file([record({ verification })]);
    expect(store.readDiscoveries()[0].verification).toEqual(verification);
  });
});

describe("readConnections — origin normalization", () => {
  const legacy = (id: string): Record<string, unknown> => ({
    id,
    kind: id.startsWith("learning:") ? "learning" : "session",
    title: id,
    date: null,
    summary: "",
    // deliberately no `origin` — written before the field existed
    topics: [],
    linksTo: [],
    linkedFrom: [],
    sourceMtime: 1,
    indexedAt: "2026-06-10T07:00:00.000Z",
  });
  // Mirror connectionsPath's mapping: "<kind>:<key>" -> "<kind>--<key>.json"
  // with any trailing .md on the key stripped.
  const writeRaw = (id: string, obj: unknown) => {
    const file = id
      .replace(/^learning:/, "learning--")
      .replace(/^session:/, "session--")
      .replace(/\.md$/, "");
    mkdirSync(join(brainDir, "connections"), { recursive: true });
    writeFileSync(join(brainDir, "connections", `${file}.json`), JSON.stringify(obj));
  };

  it("backfills a missing origin: learning -> direct, session -> agent", () => {
    writeRaw("learning:l.md", legacy("learning:l.md"));
    writeRaw("session:s-1", legacy("session:s-1"));
    expect(store.readConnections("learning:l.md")?.origin).toBe("direct");
    expect(store.readConnections("session:s-1")?.origin).toBe("agent");
    const byId = Object.fromEntries(store.readAllConnections().map((c) => [c.id, c.origin]));
    expect(byId).toEqual({ "learning:l.md": "direct", "session:s-1": "agent" });
  });

  it("leaves an explicit origin untouched", () => {
    writeRaw("session:s-2", { ...legacy("session:s-2"), origin: "direct" });
    expect(store.readConnections("session:s-2")?.origin).toBe("direct");
  });
});

describe("readHidden / writeHidden", () => {
  it("returns an empty set when the file is missing", () => {
    expect(store.readHidden()).toEqual({ docs: [], topics: [] });
  });

  it("round-trips docs + topics and tolerates a corrupt/partial file", () => {
    store.writeHidden({ docs: ["learning:a.md"], topics: ["project-alpha"] });
    expect(store.readHidden()).toEqual({ docs: ["learning:a.md"], topics: ["project-alpha"] });

    writeFileSync(join(brainDir, "hidden.json"), "{ not json");
    expect(store.readHidden()).toEqual({ docs: [], topics: [] });

    writeFileSync(join(brainDir, "hidden.json"), JSON.stringify({ docs: ["x"] }));
    expect(store.readHidden()).toEqual({ docs: ["x"], topics: [] });
  });
});

describe("brain-sweep boot", () => {
  it("re-queues active hypotheses stranded on 'running' by a crash; dismissed stay untouched", async () => {
    const running: BrainVerification = {
      status: "running",
      verdict: null,
      detail: "",
      evidence: [],
      checkedAt: null,
    };
    file([
      record({ id: "stranded", verification: running }),
      record({ id: "buried", status: "dismissed", verification: running }),
    ]);

    await import("./brain-sweep.ts"); // boot reconciliation runs at module load

    const byId = Object.fromEntries(
      (JSON.parse(readFileSync(join(brainDir, "discoveries.json"), "utf8")).discoveries as
        BrainDiscovery[]).map((d) => [d.id, d.verification.status]),
    );
    expect(byId).toEqual({ stranded: "pending", buried: "running" });
  });
});
