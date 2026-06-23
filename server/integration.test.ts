import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Mock the multi-minute connector sweep with a canned brief before anything
// loads the sweep module.
process.env.SWEEP_MOCK = "1";

import { db } from "./db.ts";
import * as repo from "./repo.ts";
import { api } from "./api.ts";
import { readDiscoveries, writeDiscoveries } from "./brain-store.ts";
import { PENDING_VERIFICATION } from "./brain-discover.ts";
import { getActiveSweep, startSweep } from "./sweep.ts";
import { buildDayView } from "./views.ts";
import type { BrainDiscovery, SweepJob } from "../shared/types.ts";

const json = (path: string, method?: string, body?: unknown) =>
  api.request(path, {
    method: method ?? "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

// Request + parse the JSON body in one go (the response body type is opaque).
async function reqBody(path: string, method?: string, body?: unknown): Promise<any> {
  return (await json(path, method, body)).json();
}

const learningsDir = process.env.LEARNINGS_DIR!;
function clearLearnings() {
  for (const f of readdirSync(learningsDir)) rmSync(join(learningsDir, f));
}

async function settle(job: SweepJob): Promise<void> {
  const start = Date.now();
  while (job.status === "running") {
    if (Date.now() - start > 2000) throw new Error("sweep did not settle");
    await new Promise((r) => setTimeout(r, 5));
  }
}

// Over HTTP we only have a serialized snapshot of the job, so poll the live
// server state (getActiveSweep, via the day view) instead.
async function settleApi(date: string): Promise<void> {
  const start = Date.now();
  while (getActiveSweep(date)) {
    if (Date.now() - start > 2000) throw new Error("sweep did not settle");
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  db.exec("DELETE FROM sections; DELETE FROM editions; DELETE FROM tasks; DELETE FROM days;");
  clearLearnings();
});

describe("repo round-trips", () => {
  it("creates a day, edition, and sections and reads them back in sort order", () => {
    repo.upsertDay({ date: "2026-06-01" });
    const ed = repo.createEdition({ date: "2026-06-01", label: "Morning", trigger: "morning" });
    repo.createSection({ editionId: ed.id, date: "2026-06-01", source: "linear", title: "B", bodyMd: "", sort: 1 });
    repo.createSection({ editionId: ed.id, date: "2026-06-01", source: "slack", title: "A", bodyMd: "", sort: 0 });
    expect(repo.getSectionsByEdition(ed.id).map((s) => s.title)).toEqual(["A", "B"]);
  });

  it("lists editions newest-first", () => {
    repo.upsertDay({ date: "2026-06-02" });
    const first = repo.createEdition({ date: "2026-06-02", label: "Morning", trigger: "morning" });
    const second = repo.createEdition({ date: "2026-06-02", label: "Reset", trigger: "manual" });
    expect(repo.listEditions("2026-06-02").map((e) => e.id)).toEqual([second.id, first.id]);
  });

  it("dismiss sets a dismissed_at; reopen clears it", () => {
    repo.upsertDay({ date: "2026-06-03" });
    const ed = repo.createEdition({ date: "2026-06-03", label: "M", trigger: "morning" });
    const s = repo.createSection({ editionId: ed.id, date: "2026-06-03", source: "slack", title: "x", bodyMd: "" });
    expect(repo.setSectionStatus(s.id, "done")?.dismissedAt).toBeTruthy();
    expect(repo.setSectionStatus(s.id, "active")?.dismissedAt).toBeNull();
  });

  it("only one task is current at a time", () => {
    const a = repo.createTask({ title: "a", isCurrent: true });
    const b = repo.createTask({ title: "b", isCurrent: true });
    expect(repo.getTask(a.id)?.isCurrent).toBe(false);
    expect(repo.getTask(b.id)?.isCurrent).toBe(true);
  });
});

describe("sweep lifecycle (in-process)", () => {
  it("advertises an active sweep while running, then clears it", async () => {
    const job = startSweep({ date: "2026-06-04" });
    // Synchronously after start, before the mock brief resolves:
    expect(getActiveSweep("2026-06-04")?.id).toBe(job.id);
    expect(job.routines.every((r) => ["pending", "running"].includes(r.status))).toBe(true);

    await settle(job);
    expect(getActiveSweep("2026-06-04")).toBeNull();
    expect(job.routines.every((r) => r.status === "done")).toBe(true);
  });

  it("parses the mock brief into sections including email and calendar", async () => {
    await settle(startSweep({ date: "2026-06-05" }));
    const sources = buildDayView("2026-06-05").sections.map((s) => s.source);
    expect(sources).toEqual(
      expect.arrayContaining(["slack", "linear", "email", "calendar", "github"]),
    );
  });

  it("scopes activeSweep to the date being viewed", async () => {
    const job = startSweep({ date: "2026-06-06" });
    expect(getActiveSweep("2026-06-07")).toBeNull(); // different day
    await settle(job);
  });

  it("adds a Learnings highlight for docs created since the last sweep", async () => {
    writeFileSync(join(learningsDir, "2026-06-08-project-alpha-prep.md"), "# Project Alpha renewal prep\n\nnotes");
    await settle(startSweep({ date: "2026-06-10" }));

    const learnings = buildDayView("2026-06-10").sections.find((s) => s.source === "learnings");
    expect(learnings).toBeDefined();
    expect(learnings!.title).toContain("1 new");
    expect(learnings!.bodyMd).toContain("Project Alpha renewal prep");
  });

  it("omits the Learnings highlight when nothing new", async () => {
    await settle(startSweep({ date: "2026-06-11" }));
    const sections = buildDayView("2026-06-11").sections;
    expect(sections.some((s) => s.source === "learnings")).toBe(false);
  });
});

describe("sweep failure path", () => {
  it("records a failed routine as an issue + a 'failed' card without a real connector", async () => {
    delete process.env.SWEEP_MOCK; // force the real exec, which hits the bogus binary
    try {
      const job = startSweep({ date: "2026-06-20" });
      await settle(job);
      expect(job.routines.every((r) => r.status === "failed")).toBe(true);

      const day = buildDayView("2026-06-20");
      expect(day.sections.length).toBeGreaterThan(0);
      expect(day.sections.every((s) => s.title.endsWith("— failed"))).toBe(true);
      expect(day.editions[0].issues.length).toBeGreaterThan(0);
    } finally {
      process.env.SWEEP_MOCK = "1";
    }
  });
});

describe("HTTP api", () => {
  it("rejects a sweep with no date", async () => {
    const res = await json("/sweep", "POST", {});
    expect(res.status).toBe(400);
  });

  it("starts a sweep (202) with per-routine progress, and the day view reflects it", async () => {
    const res = await json("/sweep", "POST", { date: "2026-06-08" });
    expect(res.status).toBe(202);
    const job = (await res.json()) as SweepJob;
    expect(job.routines.length).toBeGreaterThan(0);

    await settleApi("2026-06-08");
    const day = await reqBody("/days/2026-06-08");
    expect(day.activeSweep).toBeNull();
    expect(day.sections.length).toBeGreaterThan(0);
  });

  it("adds, dismisses, and reopens a section card", async () => {
    const created = await reqBody("/sections", "POST", { date: "2026-06-09", title: "Manual note" });
    expect(created.title).toBe("Manual note");

    const dismissed = await reqBody(`/sections/${created.id}/dismiss`, "POST");
    expect(dismissed.status).toBe("done");
    const reopened = await reqBody(`/sections/${created.id}/reopen`, "POST");
    expect(reopened.status).toBe("active");
  });

  it("requires a title to create a task and 404s on unknown ids", async () => {
    expect((await json("/tasks", "POST", { title: "  " })).status).toBe(400);
    expect((await json("/tasks/99999/complete", "POST")).status).toBe(404);
    const t = await reqBody("/tasks", "POST", { title: "real task" });
    expect((await reqBody(`/tasks/${t.id}/complete`, "POST")).status).toBe("done");
  });

  it("requires a title to add a section card", async () => {
    expect((await json("/sections", "POST", { date: "2026-06-09" })).status).toBe(400);
  });

  it("routes the full task lifecycle and 404s for each verb on unknown ids", async () => {
    const t = await reqBody("/tasks", "POST", { title: "lifecycle" });
    expect((await reqBody(`/tasks/${t.id}/current`, "POST")).isCurrent).toBe(true);
    expect((await reqBody(`/tasks/${t.id}/unpin`, "POST")).isCurrent).toBe(false);
    expect((await reqBody(`/tasks/${t.id}/reopen`, "POST")).status).toBe("backlog");
    expect((await reqBody(`/tasks/${t.id}`, "PATCH", { title: "renamed" })).title).toBe("renamed");
    expect((await reqBody(`/tasks/${t.id}`, "DELETE")).status).toBe("deleted");

    for (const path of ["current", "unpin", "reopen"]) {
      expect((await json(`/tasks/88888/${path}`, "POST")).status).toBe(404);
    }
    expect((await json("/tasks/88888", "DELETE")).status).toBe(404);
    expect((await json("/tasks/88888", "PATCH", { title: "x" })).status).toBe(404);
    expect((await json("/sections/88888/dismiss", "POST")).status).toBe(404);
    expect((await json("/sections/88888/reopen", "POST")).status).toBe(404);
  });

  it("serves insights and learnings list", async () => {
    expect((await json("/insights?date=2026-06-08")).status).toBe(200);
    expect((await json("/learnings")).status).toBe(200);
  });

  // Just the route wiring — the brain pipeline itself is covered by
  // brain.test.ts / brain-sweep.test.ts against isolated tmp dirs.
  it("serves the brain routes", async () => {
    expect(await reqBody("/brain/search?q=")).toEqual({ topics: [], docs: [] });
    expect((await json("/brain/doc/bogus")).status).toBe(404);
    expect((await json("/brain/doc/learning%3Anope.md")).status).toBe(404);
    expect(await reqBody("/brain/sweep")).toBeNull(); // no job yet
  });
});

describe("HTTP api — brain discoveries", () => {
  const disc = (id: string, over: Partial<BrainDiscovery> = {}): BrainDiscovery => ({
    id,
    kind: "thread",
    title: `Title of ${id}`,
    insight: "Insight.",
    topics: [],
    docs: ["learning:a.md", "learning:b.md"],
    status: "active",
    hidden: false,
    firstSeen: "2026-06-01T08:00:00.000Z",
    lastSeen: "2026-06-01T08:00:00.000Z",
    verification: PENDING_VERIFICATION,
    ...over,
  });

  it("lists only active discoveries, newest lastSeen first", async () => {
    writeDiscoveries([
      disc("older"),
      disc("newer", { lastSeen: "2026-06-10T08:00:00.000Z" }),
      disc("buried", { status: "dismissed", lastSeen: "2026-06-11T08:00:00.000Z" }),
    ]);
    const list = await reqBody("/brain/discoveries");
    expect(list.map((d: BrainDiscovery) => d.id)).toEqual(["newer", "older"]);
  });

  it("dismisses a discovery, persisting the flip, and 404s on unknown ids", async () => {
    writeDiscoveries([disc("doomed"), disc("kept")]);
    const dismissed = await reqBody("/brain/discoveries/doomed/dismiss", "POST");
    expect(dismissed).toMatchObject({ id: "doomed", status: "dismissed" });

    const list = await reqBody("/brain/discoveries");
    expect(list.map((d: BrainDiscovery) => d.id)).toEqual(["kept"]);

    expect((await json("/brain/discoveries/nope/dismiss", "POST")).status).toBe(404);
  });

  it("verify 404s on unknown and dismissed ids", async () => {
    writeDiscoveries([disc("buried", { status: "dismissed" })]);
    expect((await json("/brain/discoveries/nope/verify", "POST")).status).toBe(404);
    expect((await json("/brain/discoveries/buried/verify", "POST")).status).toBe(404);
  });

  it("verify 409s while a verification is already running", async () => {
    writeDiscoveries([
      disc("busy", { verification: { ...PENDING_VERIFICATION, status: "running" } }),
    ]);
    expect((await json("/brain/discoveries/busy/verify", "POST")).status).toBe(409);
  });

  it("verify 202s with the record flipped to running, then the research lands on disk", async () => {
    writeDiscoveries([disc("checkme")]);
    const res = await json("/brain/discoveries/checkme/verify", "POST");
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      id: "checkme",
      verification: { status: "running" },
    });

    // The route fire-and-forgets the (mocked) research — wait for it to settle
    // so it can't bleed into later tests.
    const start = Date.now();
    while (readDiscoveries()[0].verification.status === "running") {
      if (Date.now() - start > 2000) throw new Error("verification did not settle");
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(readDiscoveries()[0].verification).toMatchObject({
      status: "done",
      verdict: "confirmed",
    });
  });

  it("hides/shows a doc then a topic — membership, idempotent, reversible", async () => {
    const id = "learning:hide-me.md";
    expect(await reqBody("/brain/hide", "POST", { kind: "doc", id, hidden: true })).toEqual({
      docs: [id],
      topics: [],
    });
    // Idempotent: hiding again doesn't duplicate.
    expect(await reqBody("/brain/hide", "POST", { kind: "doc", id, hidden: true })).toEqual({
      docs: [id],
      topics: [],
    });
    expect(await reqBody("/brain/hide", "POST", { kind: "topic", id: "project-alpha", hidden: true })).toEqual({
      docs: [id],
      topics: ["project-alpha"],
    });
    // Unhide the doc; the topic stays.
    expect(await reqBody("/brain/hide", "POST", { kind: "doc", id, hidden: false })).toEqual({
      docs: [],
      topics: ["project-alpha"],
    });
    // Validates kind.
    expect((await json("/brain/hide", "POST", { id, hidden: true })).status).toBe(400);
    expect((await json("/brain/hide", "POST", { kind: "doc", hidden: true })).status).toBe(400);

    // Leave the hidden set empty for any later graph reads.
    expect(await reqBody("/brain/hide", "POST", { kind: "topic", id: "project-alpha", hidden: false })).toEqual({
      docs: [],
      topics: [],
    });
  });

  it("hides a discovery (record stays active) and 404s on unknown ids", async () => {
    writeDiscoveries([disc("tuckable")]);
    const hidden = await reqBody("/brain/discoveries/tuckable/hide", "POST", { hidden: true });
    expect(hidden).toMatchObject({ id: "tuckable", status: "active", hidden: true });
    expect(readDiscoveries()[0].hidden).toBe(true);

    // Still listed (the UI filters hidden ones, the server doesn't).
    const list = await reqBody("/brain/discoveries");
    expect(list.map((d: BrainDiscovery) => d.id)).toEqual(["tuckable"]);

    const shown = await reqBody("/brain/discoveries/tuckable/hide", "POST", { hidden: false });
    expect(shown.hidden).toBe(false);

    expect((await json("/brain/discoveries/nope/hide", "POST", { hidden: true })).status).toBe(404);
  });
});
