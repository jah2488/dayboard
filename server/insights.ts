import * as repo from "./repo.ts";
import { localDate } from "./util.ts";
import type { Insights, Task } from "../shared/types.ts";

const STALE_DAYS = 3;
const SOON_DAYS = 3;

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + delta));
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// Compute trends + upcoming from the historical task data.
export function buildInsights(date = localDate()): Insights {
  const open = repo.listOpenTasks(); // status = 'backlog'
  const soonCutoff = addDays(date, SOON_DAYS);

  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  const dueSoon: Task[] = [];
  for (const t of open) {
    if (!t.dueDate) continue;
    if (t.dueDate < date) overdue.push(t);
    else if (t.dueDate === date) dueToday.push(t);
    else if (t.dueDate <= soonCutoff) dueSoon.push(t);
  }

  const stale = open
    .map((t) => ({ task: t, ageDays: daysBetween(t.createdAt.slice(0, 10), date) }))
    .filter((s) => s.ageDays >= STALE_DAYS)
    .sort((a, b) => b.ageDays - a.ageDays);

  const weekly = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(date, -i);
    weekly.push({
      date: d,
      created: repo.countCreatedOn(d),
      completed: repo.countCompletedOn(d),
    });
  }

  return {
    date,
    upcoming: { overdue, dueToday, dueSoon },
    stale,
    weekly,
    totals: {
      open: open.length,
      completedThisWeek: weekly.reduce((s, w) => s + w.completed, 0),
    },
  };
}
