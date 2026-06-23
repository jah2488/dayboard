import { describe, expect, it } from "vitest";
import { aggregateUsage } from "./usage.ts";

// A fixed "now" so windowing is deterministic regardless of when the test runs.
const NOW = new Date("2026-06-22T18:00:00");

type Cat = "interactive" | "agent" | "sweep";
function rec(startedAt: string | null, tokens: number, cat: Cat) {
  return {
    startedAt,
    tokens,
    isSweep: cat === "sweep",
    origin: (cat === "interactive" ? "direct" : "agent") as "direct" | "agent",
  };
}

describe("aggregateUsage", () => {
  it("splits tokens three ways and computes sweep share", () => {
    const u = aggregateUsage(
      [
        rec("2026-06-22T09:00:00", 1000, "sweep"),
        rec("2026-06-22T10:00:00", 3000, "interactive"),
        rec("2026-06-22T11:00:00", 600, "agent"),
      ],
      [],
      "week",
      NOW,
    );
    expect(u.totals.totalTokens).toBe(4600);
    expect(u.totals.interactiveTokens).toBe(3000);
    expect(u.totals.agentTokens).toBe(600);
    expect(u.totals.sweepTokens).toBe(1000);
    expect(u.totals.sweepShare).toBeCloseTo(1000 / 4600);
  });

  it("counts only interactive sessions (subagent runs are not 'sessions')", () => {
    const u = aggregateUsage(
      [
        rec("2026-06-22T09:00:00", 100, "interactive"),
        rec("2026-06-22T10:00:00", 100, "agent"),
        rec("2026-06-22T11:00:00", 100, "agent"),
        rec("2026-06-22T12:00:00", 100, "sweep"),
      ],
      [],
      "week",
      NOW,
    );
    expect(u.totals.sessions).toBe(1); // the interactive one
    expect(u.totals.agentRuns).toBe(3); // two agent + one sweep
  });

  it("excludes records outside the window", () => {
    const u = aggregateUsage(
      [
        rec("2026-06-21T12:00:00", 500, "interactive"),
        rec("2026-05-01T12:00:00", 9999, "sweep"),
      ],
      [],
      "week",
      NOW,
    );
    expect(u.totals.totalTokens).toBe(500);
    expect(u.totals.sessions).toBe(1);
  });

  it("uses 6h buckets for week, daily for month, weekly for all", () => {
    const recs = [rec("2026-06-22T09:00:00", 100, "interactive")];
    expect(aggregateUsage(recs, [], "week", NOW).bucketHours).toBe(6);
    expect(aggregateUsage(recs, [], "month", NOW).bucketHours).toBe(24);
    expect(aggregateUsage(recs, [], "all", NOW).bucketHours).toBe(168);
  });

  it("lands two same-morning sessions in one 6h bucket", () => {
    const u = aggregateUsage(
      [
        rec("2026-06-22T07:30:00", 100, "interactive"), // 06:00–12:00 local bucket
        rec("2026-06-22T11:00:00", 200, "sweep"), // same bucket
        rec("2026-06-22T13:00:00", 400, "interactive"), // 12:00–18:00 bucket
      ],
      [],
      "week",
      NOW,
    );
    const total = (b: { interactiveTokens: number; agentTokens: number; sweepTokens: number }) =>
      b.interactiveTokens + b.agentTokens + b.sweepTokens;
    const nonEmpty = u.buckets.filter((b) => total(b) > 0);
    expect(nonEmpty).toHaveLength(2);
    const morning = nonEmpty.find((b) => b.interactiveTokens === 100);
    expect(morning?.sweepTokens).toBe(200);
  });

  it("counts interactive sessions per day with zero-filled gaps", () => {
    const u = aggregateUsage(
      [
        rec("2026-06-20T09:00:00", 10, "interactive"),
        rec("2026-06-20T15:00:00", 10, "interactive"),
        rec("2026-06-21T09:00:00", 10, "agent"), // not interactive — must not count
        rec("2026-06-22T09:00:00", 10, "interactive"),
      ],
      [],
      "week",
      NOW,
    );
    const byDate = new Map(u.sessionsPerDay.map((d) => [d.date, d.sessions]));
    expect(byDate.get("2026-06-20")).toBe(2);
    expect(byDate.get("2026-06-21")).toBe(0); // gap day present, at zero (agent excluded)
    expect(byDate.get("2026-06-22")).toBe(1);
  });

  it("returns the top 3 topics by in-window doc count", () => {
    const td = (slug: string, label: string, date: string) => ({ slug, label, date });
    const u = aggregateUsage(
      [rec("2026-06-22T09:00:00", 10, "interactive")],
      [
        td("project-alpha", "Project Alpha", "2026-06-21"),
        td("project-alpha", "Project Alpha", "2026-06-22"),
        td("project-alpha", "Project Alpha", "2026-06-20"),
        td("project-beta", "Project Beta", "2026-06-22"),
        td("project-beta", "Project Beta", "2026-06-21"),
        td("project-gamma", "Project Gamma", "2026-06-22"),
        td("project-epsilon", "Project Epsilon", "2026-06-22"),
        td("stale", "Stale", "2026-01-01"), // out of the week window — ignored
      ],
      "week",
      NOW,
    );
    expect(u.topTopics.map((t) => t.slug)).toEqual(["project-alpha", "project-beta", "project-epsilon"]);
    expect(u.topTopics[0].docs).toBe(3);
  });
});
