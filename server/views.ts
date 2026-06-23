import * as repo from "./repo.ts";
import { getActiveSweep } from "./sweep.ts";
import type { DayView } from "../shared/types.ts";

// Assemble the full payload for one day at a given edition (defaults to newest).
export function buildDayView(date: string, wantEdition?: number): DayView {
  const editions = repo.listEditions(date);
  const selected =
    (wantEdition && editions.find((e) => e.id === wantEdition)?.id) ??
    editions[0]?.id ??
    null;
  const open = repo.listOpenTasks();
  const current = open.find((t) => t.isCurrent) ?? null;
  const backlog = open.filter((t) => !t.isCurrent);
  return {
    date,
    day: repo.getDay(date),
    editions,
    selectedEditionId: selected,
    activeSweep: getActiveSweep(date),
    sections: selected ? repo.getSectionsByEdition(selected) : [],
    tasks: { current, backlog, doneToday: repo.listDoneTasks(date) },
  };
}

// Get the newest edition for a date, creating one (and the day) if none exists.
// Used when something wants to attach a section to "today" out of band.
export function ensureEdition(date: string, label = "Notes"): number {
  const existing = repo.listEditions(date);
  if (existing.length) return existing[0].id;
  repo.upsertDay({ date });
  return repo.createEdition({ date, label, trigger: "manual" }).id;
}
