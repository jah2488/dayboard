import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import * as repo from "./repo.ts";
import { buildInsights } from "./insights.ts";

const DATE = "2026-06-15";

beforeEach(() => {
  db.exec("DELETE FROM tasks;");
});

// created_at / completed_at default to now(); override them to place a task on a
// specific calendar day for the age/weekly math.
function backdateCreated(id: number, date: string) {
  db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(`${date} 09:00:00`, id);
}
function setCompleted(id: number, date: string) {
  db.prepare(
    "UPDATE tasks SET status = 'done', is_current = 0, completed_at = ? WHERE id = ?",
  ).run(`${date} 17:00:00`, id);
}

describe("buildInsights", () => {
  it("is all-zero on an empty database with a 7-day window", () => {
    const ins = buildInsights(DATE);
    expect(ins.totals.open).toBe(0);
    expect(ins.weekly).toHaveLength(7);
    expect(ins.weekly.every((w) => w.created === 0 && w.completed === 0)).toBe(true);
    expect(ins.upcoming).toEqual({ overdue: [], dueToday: [], dueSoon: [] });
  });

  it("buckets tasks into overdue / dueToday / dueSoon and ignores far-future", () => {
    repo.createTask({ title: "overdue", dueDate: "2026-06-14" });
    repo.createTask({ title: "today", dueDate: DATE });
    repo.createTask({ title: "soon", dueDate: "2026-06-17" });
    repo.createTask({ title: "far", dueDate: "2026-06-30" });
    repo.createTask({ title: "no due date" });

    const { upcoming, totals } = buildInsights(DATE);
    expect(upcoming.overdue.map((t) => t.title)).toEqual(["overdue"]);
    expect(upcoming.dueToday.map((t) => t.title)).toEqual(["today"]);
    expect(upcoming.dueSoon.map((t) => t.title)).toEqual(["soon"]);
    expect(totals.open).toBe(5);
  });

  it("flags tasks open 3+ days as stale, oldest first", () => {
    const a = repo.createTask({ title: "old" });
    const b = repo.createTask({ title: "older" });
    const c = repo.createTask({ title: "fresh" });
    backdateCreated(a.id, "2026-06-11"); // 4 days before DATE
    backdateCreated(b.id, "2026-06-09"); // 6 days before DATE
    backdateCreated(c.id, DATE); // same day -> age 0, not stale

    const stale = buildInsights(DATE).stale;
    expect(stale.map((s) => s.task.title)).toEqual(["older", "old"]);
    expect(stale[0].ageDays).toBe(6);
  });

  it("counts completions in the weekly series and the week total", () => {
    const t = repo.createTask({ title: "shipped" });
    setCompleted(t.id, DATE);
    const ins = buildInsights(DATE);
    expect(ins.weekly.at(-1)).toMatchObject({ date: DATE, completed: 1 });
    expect(ins.totals.completedThisWeek).toBe(1);
    expect(ins.totals.open).toBe(0); // completed -> no longer backlog
  });
});
