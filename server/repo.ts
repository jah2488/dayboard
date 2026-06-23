import { db, tx } from "./db.ts";
import type {
  Day,
  Edition,
  EditionTrigger,
  OpenPr,
  PrCi,
  Section,
  SectionSource,
  SessionSummaryCache,
  Task,
} from "../shared/types.ts";

// Row read/write for github_prs lives at the bottom of this file.
type StoredPr = Omit<OpenPr, "ageDays">;

// ---- row mappers (node:sqlite returns null-prototype, snake_case rows) ----

type Row = Record<string, unknown>;

function mapDay(r: Row): Day {
  return {
    date: r.date as string,
    greeting: (r.greeting as string) ?? null,
    firstMeetingAt: (r.first_meeting_at as string) ?? null,
    meetingCount: (r.meeting_count as number) ?? null,
    createdAt: r.created_at as string,
  };
}

function mapEdition(r: Row): Edition {
  let issues: Edition["issues"] = [];
  if (r.issues) {
    try {
      issues = JSON.parse(r.issues as string);
    } catch {
      issues = [];
    }
  }
  return {
    id: r.id as number,
    date: r.date as string,
    label: r.label as string,
    trigger: r.trigger as EditionTrigger,
    createdAt: r.created_at as string,
    issues,
  };
}

function mapSection(r: Row): Section {
  return {
    id: r.id as number,
    editionId: r.edition_id as number,
    date: r.date as string,
    source: r.source as SectionSource,
    title: r.title as string,
    bodyMd: r.body_md as string,
    sort: r.sort as number,
    status: r.status as Section["status"],
    createdAt: r.created_at as string,
    dismissedAt: (r.dismissed_at as string) ?? null,
  };
}

function mapTask(r: Row): Task {
  return {
    id: r.id as number,
    title: r.title as string,
    notes: (r.notes as string) ?? null,
    status: r.status as Task["status"],
    isCurrent: Boolean(r.is_current),
    sourceSectionId: (r.source_section_id as number) ?? null,
    sourceDate: (r.source_date as string) ?? null,
    dueDate: (r.due_date as string) ?? null,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string) ?? null,
  };
}

// ---- days ----

export function getDay(date: string): Day | null {
  const r = db.prepare("SELECT * FROM days WHERE date = ?").get(date) as
    | Row
    | undefined;
  return r ? mapDay(r) : null;
}

export function upsertDay(d: {
  date: string;
  greeting?: string | null;
  firstMeetingAt?: string | null;
  meetingCount?: number | null;
}): Day {
  db.prepare(
    `INSERT INTO days (date, greeting, first_meeting_at, meeting_count)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       greeting = COALESCE(excluded.greeting, days.greeting),
       first_meeting_at = COALESCE(excluded.first_meeting_at, days.first_meeting_at),
       meeting_count = COALESCE(excluded.meeting_count, days.meeting_count)`,
  ).run(
    d.date,
    d.greeting ?? null,
    d.firstMeetingAt ?? null,
    d.meetingCount ?? null,
  );
  return getDay(d.date)!;
}

// ---- editions ----

export function listEditions(date: string): Edition[] {
  return (
    db
      .prepare("SELECT * FROM editions WHERE date = ? ORDER BY created_at DESC, id DESC")
      .all(date) as Row[]
  ).map(mapEdition);
}

export function getEdition(id: number): Edition | null {
  const r = db.prepare("SELECT * FROM editions WHERE id = ?").get(id) as
    | Row
    | undefined;
  return r ? mapEdition(r) : null;
}

// The most recent edition across all dates — i.e. the previous sweep. Used to
// scope "since last sweep" windows (read before creating the new edition).
export function latestEdition(): Edition | null {
  const r = db
    .prepare("SELECT * FROM editions ORDER BY created_at DESC, id DESC LIMIT 1")
    .get() as Row | undefined;
  return r ? mapEdition(r) : null;
}

export function createEdition(e: {
  date: string;
  label: string;
  trigger: EditionTrigger;
}): Edition {
  const info = db
    .prepare("INSERT INTO editions (date, label, trigger) VALUES (?, ?, ?)")
    .run(e.date, e.label, e.trigger);
  return getEdition(Number(info.lastInsertRowid))!;
}

export function setEditionIssues(
  id: number,
  issues: Array<{ source: string; message: string }>,
): void {
  db.prepare("UPDATE editions SET issues = ? WHERE id = ?").run(
    JSON.stringify(issues),
    id,
  );
}

// ---- sections ----

export function getSectionsByEdition(editionId: number): Section[] {
  return (
    db
      .prepare("SELECT * FROM sections WHERE edition_id = ? ORDER BY sort, id")
      .all(editionId) as Row[]
  ).map(mapSection);
}

export function createSection(s: {
  editionId: number;
  date: string;
  source: SectionSource;
  title: string;
  bodyMd: string;
  sort?: number;
}): Section {
  const info = db
    .prepare(
      "INSERT INTO sections (edition_id, date, source, title, body_md, sort) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(s.editionId, s.date, s.source, s.title, s.bodyMd, s.sort ?? 0);
  return getSection(Number(info.lastInsertRowid))!;
}

export function getSection(id: number): Section | null {
  const r = db.prepare("SELECT * FROM sections WHERE id = ?").get(id) as
    | Row
    | undefined;
  return r ? mapSection(r) : null;
}

export function setSectionStatus(
  id: number,
  status: Section["status"],
): Section | null {
  db.prepare(
    `UPDATE sections
       SET status = ?, dismissed_at = CASE WHEN ? = 'active' THEN NULL ELSE datetime('now') END
     WHERE id = ?`,
  ).run(status, status, id);
  return getSection(id);
}

// ---- tasks ----
// Lifecycle status: 'backlog' (open) | 'done' | 'deleted'. The single pinned
// "right now" task is the open task with is_current = 1.

export function listOpenTasks(): Task[] {
  return (
    db
      .prepare(
        "SELECT * FROM tasks WHERE status = 'backlog' ORDER BY is_current DESC, created_at",
      )
      .all() as Row[]
  ).map(mapTask);
}

export function listDoneTasks(date: string): Task[] {
  return (
    db
      .prepare(
        "SELECT * FROM tasks WHERE status = 'done' AND date(completed_at) = ? ORDER BY completed_at DESC",
      )
      .all(date) as Row[]
  ).map(mapTask);
}

export function countCompletedOn(date: string): number {
  const r = db
    .prepare(
      "SELECT count(*) AS n FROM tasks WHERE status = 'done' AND date(completed_at) = ?",
    )
    .get(date) as Row;
  return r.n as number;
}

export function countCreatedOn(date: string): number {
  const r = db
    .prepare("SELECT count(*) AS n FROM tasks WHERE date(created_at) = ?")
    .get(date) as Row;
  return r.n as number;
}

export function getTask(id: number): Task | null {
  const r = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    | Row
    | undefined;
  return r ? mapTask(r) : null;
}

export function createTask(t: {
  title: string;
  notes?: string | null;
  isCurrent?: boolean;
  sourceSectionId?: number | null;
  sourceDate?: string | null;
  dueDate?: string | null;
}): Task {
  const makeCurrent = Boolean(t.isCurrent);
  const id = tx(() => {
    if (makeCurrent) db.prepare("UPDATE tasks SET is_current = 0").run();
    const info = db
      .prepare(
        `INSERT INTO tasks (title, notes, status, is_current, source_section_id, source_date, due_date)
         VALUES (?, ?, 'backlog', ?, ?, ?, ?)`,
      )
      .run(
        t.title,
        t.notes ?? null,
        makeCurrent ? 1 : 0,
        t.sourceSectionId ?? null,
        t.sourceDate ?? null,
        t.dueDate ?? null,
      );
    return Number(info.lastInsertRowid);
  });
  return getTask(id)!;
}

export function setCurrent(id: number): Task | null {
  tx(() => {
    db.prepare("UPDATE tasks SET is_current = 0").run();
    db.prepare(
      "UPDATE tasks SET is_current = 1, status = 'backlog', completed_at = NULL WHERE id = ?",
    ).run(id);
  });
  return getTask(id);
}

export function unpin(id: number): Task | null {
  db.prepare("UPDATE tasks SET is_current = 0 WHERE id = ?").run(id);
  return getTask(id);
}

export function completeTask(id: number): Task | null {
  db.prepare(
    "UPDATE tasks SET status = 'done', is_current = 0, completed_at = datetime('now') WHERE id = ?",
  ).run(id);
  return getTask(id);
}

export function reopenTask(id: number): Task | null {
  db.prepare(
    "UPDATE tasks SET status = 'backlog', completed_at = NULL WHERE id = ?",
  ).run(id);
  return getTask(id);
}

export function deleteTask(id: number): Task | null {
  db.prepare(
    "UPDATE tasks SET status = 'deleted', is_current = 0 WHERE id = ?",
  ).run(id);
  return getTask(id);
}

export function updateTask(
  id: number,
  fields: { title?: string; notes?: string | null; dueDate?: string | null },
): Task | null {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.title !== undefined) {
    sets.push("title = ?");
    vals.push(fields.title);
  }
  if (fields.notes !== undefined) {
    sets.push("notes = ?");
    vals.push(fields.notes);
  }
  if (fields.dueDate !== undefined) {
    sets.push("due_date = ?");
    vals.push(fields.dueDate);
  }
  if (sets.length) {
    vals.push(id);
    db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as never[]));
  }
  return getTask(id);
}

// ---- session summaries (cached LLM enrichment for the Sessions tab) ----

export function getSessionSummary(sessionId: string): SessionSummaryCache | null {
  const r = db
    .prepare("SELECT goal, outcome, model, created_at FROM session_summaries WHERE session_id = ?")
    .get(sessionId) as Row | undefined;
  if (!r) return null;
  return {
    goal: r.goal as string,
    outcome: r.outcome as string,
    model: (r.model as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export function upsertSessionSummary(s: {
  sessionId: string;
  goal: string;
  outcome: string;
  model: string | null;
}): SessionSummaryCache {
  db.prepare(
    `INSERT INTO session_summaries (session_id, goal, outcome, model)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       goal = excluded.goal, outcome = excluded.outcome,
       model = excluded.model, created_at = datetime('now')`,
  ).run(s.sessionId, s.goal, s.outcome, s.model);
  return getSessionSummary(s.sessionId)!;
}

// ---- github PRs (the PRs tab) ----
// The whole set is replaced on each successful sweep refresh — no upsert/merge,
// so closed/merged PRs disappear. ageDays is computed by the caller at read time.

function mapPr(r: Row): StoredPr {
  const arr = (v: unknown): string[] => {
    try {
      return JSON.parse((v as string) ?? "[]");
    } catch {
      return [];
    }
  };
  return {
    repo: r.repo as string,
    number: r.number as number,
    title: r.title as string,
    url: r.url as string,
    isDraft: Boolean(r.is_draft),
    stateLabel: r.state_label as string,
    reviewDecision: (r.review_decision as string) ?? null,
    mergeState: (r.merge_state as string) ?? null,
    mergeable: (r.mergeable as string) ?? null,
    ci: r.ci as PrCi,
    flags: arr(r.flags),
    reviewChannel: (r.review_channel as string) ?? null,
    channelVerified: Boolean(r.channel_verified),
    tickets: arr(r.tickets),
    blockedBy: arr(r.blocked_by),
    note: r.note as string,
    createdAt: r.created_at as string,
    fetchedAt: r.fetched_at as string,
  };
}

export function listGithubPrs(): StoredPr[] {
  return (
    db
      .prepare("SELECT * FROM github_prs ORDER BY created_at ASC")
      .all() as Row[]
  ).map(mapPr);
}

export function replaceGithubPrs(rows: StoredPr[]): void {
  tx(() => {
    db.prepare("DELETE FROM github_prs").run();
    const stmt = db.prepare(
      `INSERT INTO github_prs
         (repo, number, title, url, is_draft, state_label, review_decision,
          merge_state, mergeable, ci, flags, review_channel, channel_verified,
          tickets, blocked_by, note, created_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of rows) {
      stmt.run(
        p.repo,
        p.number,
        p.title,
        p.url,
        p.isDraft ? 1 : 0,
        p.stateLabel,
        p.reviewDecision,
        p.mergeState,
        p.mergeable,
        p.ci,
        JSON.stringify(p.flags),
        p.reviewChannel,
        p.channelVerified ? 1 : 0,
        JSON.stringify(p.tickets),
        JSON.stringify(p.blockedBy),
        p.note,
        p.createdAt,
        p.fetchedAt,
      );
    }
  });
}
