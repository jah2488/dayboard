import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import * as repo from "./repo.ts";

beforeEach(() => {
  db.exec("DELETE FROM sections; DELETE FROM editions; DELETE FROM tasks; DELETE FROM days;");
});

describe("days", () => {
  it("upsert merges non-null fields and leaves others intact (COALESCE)", () => {
    repo.upsertDay({ date: "2026-06-01", greeting: "hi", meetingCount: 2 });
    repo.upsertDay({ date: "2026-06-01", greeting: "updated" }); // meetingCount omitted
    const day = repo.getDay("2026-06-01");
    expect(day?.greeting).toBe("updated");
    expect(day?.meetingCount).toBe(2);
  });
  it("getDay returns null for an unknown date", () => {
    expect(repo.getDay("1999-01-01")).toBeNull();
  });
});

describe("editions", () => {
  it("round-trips issues as JSON", () => {
    repo.upsertDay({ date: "2026-06-02" });
    const ed = repo.createEdition({ date: "2026-06-02", label: "M", trigger: "morning" });
    repo.setEditionIssues(ed.id, [{ source: "GitHub", message: "down" }]);
    expect(repo.listEditions("2026-06-02")[0].issues).toEqual([
      { source: "GitHub", message: "down" },
    ]);
  });
  it("getEdition returns null when missing", () => {
    expect(repo.getEdition(99999)).toBeNull();
  });

  it("latestEdition returns the most recent across all dates (null when none)", () => {
    expect(repo.latestEdition()).toBeNull();
    repo.upsertDay({ date: "2026-06-01" });
    repo.upsertDay({ date: "2026-06-03" });
    repo.createEdition({ date: "2026-06-01", label: "old", trigger: "morning" });
    const newest = repo.createEdition({ date: "2026-06-03", label: "new", trigger: "morning" });
    expect(repo.latestEdition()?.id).toBe(newest.id);
  });
});

describe("task lifecycle", () => {
  it("complete -> done with a completed_at, reopen -> backlog and cleared", () => {
    const t = repo.createTask({ title: "x" });
    expect(repo.completeTask(t.id)?.status).toBe("done");
    expect(repo.completeTask(t.id)?.completedAt).toBeTruthy();
    const re = repo.reopenTask(t.id);
    expect(re?.status).toBe("backlog");
    expect(re?.completedAt).toBeNull();
  });

  it("setCurrent revives a completed task and unpins the rest", () => {
    const a = repo.createTask({ title: "a", isCurrent: true });
    const b = repo.createTask({ title: "b" });
    repo.completeTask(b.id);
    repo.setCurrent(b.id);
    expect(repo.getTask(b.id)).toMatchObject({ isCurrent: true, status: "backlog" });
    expect(repo.getTask(a.id)?.isCurrent).toBe(false);
  });

  it("unpin clears the current flag", () => {
    const t = repo.createTask({ title: "x", isCurrent: true });
    expect(repo.unpin(t.id)?.isCurrent).toBe(false);
  });

  it("delete moves the task to 'deleted' and out of the open list", () => {
    const t = repo.createTask({ title: "gone" });
    expect(repo.deleteTask(t.id)?.status).toBe("deleted");
    expect(repo.listOpenTasks()).toHaveLength(0);
  });

  it("updateTask sets only the provided fields", () => {
    const t = repo.createTask({ title: "orig", dueDate: "2026-06-10" });
    const u = repo.updateTask(t.id, { title: "renamed" });
    expect(u).toMatchObject({ title: "renamed", dueDate: "2026-06-10" });
  });

  it("updateTask with no fields is a no-op that still returns the task", () => {
    const t = repo.createTask({ title: "same" });
    expect(repo.updateTask(t.id, {})?.title).toBe("same");
  });

  it("listDoneTasks is scoped to the completion date", () => {
    const t = repo.createTask({ title: "done one" });
    repo.completeTask(t.id);
    db.prepare("UPDATE tasks SET completed_at = ? WHERE id = ?").run("2026-06-05 12:00:00", t.id);
    expect(repo.listDoneTasks("2026-06-05").map((x) => x.title)).toEqual(["done one"]);
    expect(repo.listDoneTasks("2026-06-06")).toHaveLength(0);
  });

  it("counts creations and completions on a given day", () => {
    const t = repo.createTask({ title: "x" });
    repo.completeTask(t.id);
    db.prepare("UPDATE tasks SET created_at = ?, completed_at = ? WHERE id = ?").run(
      "2026-06-07 09:00:00",
      "2026-06-07 17:00:00",
      t.id,
    );
    expect(repo.countCreatedOn("2026-06-07")).toBe(1);
    expect(repo.countCompletedOn("2026-06-07")).toBe(1);
  });

  it("returns null for operations on unknown task ids", () => {
    expect(repo.getTask(123456)).toBeNull();
    expect(repo.completeTask(123456)).toBeNull();
  });
});
