import type {
  BrainDiscovery,
  BrainGraph,
  BrainHidden,
  BrainSearchResult,
  BrainSweepJob,
  ConfigCheck,
  DayboardConfig,
  DayView,
  Insights,
  LearningContent,
  LearningDoc,
  OpenPr,
  RoutinePrompt,
  Section,
  SessionDetail,
  SessionListItem,
  SessionSummaryCache,
  SweepJob,
  Task,
  Usage,
  UsageRange,
} from "../shared/types";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  getDay: (date: string, edition?: number | null) =>
    fetch(`/api/days/${date}${edition ? `?edition=${edition}` : ""}`).then(
      j<DayView>,
    ),

  startSweep: (date: string, label?: string) =>
    fetch("/api/sweep", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, label }),
    }).then(j<SweepJob>),

  dismissSection: (id: number) =>
    fetch(`/api/sections/${id}/dismiss`, { method: "POST" }).then(j<Section>),
  reopenSection: (id: number) =>
    fetch(`/api/sections/${id}/reopen`, { method: "POST" }).then(j<Section>),

  createTask: (body: {
    title: string;
    isCurrent?: boolean;
    sourceSectionId?: number | null;
    sourceDate?: string | null;
  }) =>
    fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(j<Task>),

  setCurrent: (id: number) =>
    fetch(`/api/tasks/${id}/current`, { method: "POST" }).then(j<Task>),
  unpin: (id: number) =>
    fetch(`/api/tasks/${id}/unpin`, { method: "POST" }).then(j<Task>),
  complete: (id: number) =>
    fetch(`/api/tasks/${id}/complete`, { method: "POST" }).then(j<Task>),
  reopen: (id: number) =>
    fetch(`/api/tasks/${id}/reopen`, { method: "POST" }).then(j<Task>),
  remove: (id: number) =>
    fetch(`/api/tasks/${id}`, { method: "DELETE" }).then(j<Task>),
  setDue: (id: number, dueDate: string | null) =>
    fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dueDate }),
    }).then(j<Task>),

  getInsights: (date: string) =>
    fetch(`/api/insights?date=${date}`).then(j<Insights>),

  getUsage: (range: UsageRange) =>
    fetch(`/api/usage?range=${range}`).then(j<Usage>),

  listLearnings: () => fetch("/api/learnings").then(j<LearningDoc[]>),
  getLearning: (file: string) =>
    fetch(`/api/learnings/${encodeURIComponent(file)}`).then(j<LearningContent>),

  getBrainGraph: () => fetch("/api/brain").then(j<BrainGraph>),
  searchBrain: (q: string) =>
    fetch(`/api/brain/search?q=${encodeURIComponent(q)}`).then(
      j<BrainSearchResult>,
    ),
  getDiscoveries: () =>
    fetch("/api/brain/discoveries").then(j<BrainDiscovery[]>),
  dismissDiscovery: (id: string) =>
    fetch(`/api/brain/discoveries/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
    }).then(j<BrainDiscovery>),
  verifyDiscovery: (id: string) =>
    fetch(`/api/brain/discoveries/${encodeURIComponent(id)}/verify`, {
      method: "POST",
    }).then(j<BrainDiscovery>),
  hideDiscovery: (id: string, hidden: boolean) =>
    fetch(`/api/brain/discoveries/${encodeURIComponent(id)}/hide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hidden }),
    }).then(j<BrainDiscovery>),
  // Hide/show a graph node (doc id or topic slug). Reversible — never deletes.
  hideNode: (kind: "doc" | "topic", id: string, hidden: boolean) =>
    fetch("/api/brain/hide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, id, hidden }),
    }).then(j<BrainHidden>),
  startBrainSweep: (force?: boolean) =>
    fetch("/api/brain/sweep", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: !!force }),
    }).then(j<BrainSweepJob>),
  // Focused synthesis of 2+ selected topics — returns a markdown verdict.
  surfaceOverlap: (topics: string[]) =>
    fetch("/api/brain/overlap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics }),
    }).then(j<{ topics: { slug: string; label: string }[]; markdown: string }>),
  getBrainSweep: () =>
    fetch("/api/brain/sweep").then(j<BrainSweepJob | null>),

  listOpenPrs: () => fetch("/api/github/prs").then(j<OpenPr[]>),
  refreshOpenPrs: () =>
    fetch("/api/github/prs/refresh", { method: "POST" }).then(j<OpenPr[]>),

  listSessions: () => fetch("/api/sessions").then(j<SessionListItem[]>),
  tagUntaggedSessions: () =>
    fetch("/api/sessions/tag-backfill", { method: "POST" }).then(
      j<{ tagged: number; deferred: boolean; errors: number; remaining: number }>,
    ),
  getSession: (id: string) =>
    fetch(`/api/sessions/${encodeURIComponent(id)}`).then(j<SessionDetail>),
  summarizeSession: (id: string) =>
    fetch(`/api/sessions/${encodeURIComponent(id)}/summarize`, {
      method: "POST",
    }).then(j<SessionSummaryCache>),

  // ---- config / admin ----
  getConfigStatus: () =>
    fetch("/api/config/status").then(j<{ configured: boolean }>),
  getConfig: () => fetch("/api/config").then(j<DayboardConfig>),
  patchConfig: (patch: Record<string, unknown>) =>
    fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<DayboardConfig>),
  getConfigCheck: () => fetch("/api/config/check").then(j<ConfigCheck>),
  getRoutines: () =>
    fetch("/api/routines").then(j<{ sweep: RoutinePrompt[]; brain: RoutinePrompt[] }>),
  saveRoutinePrompt: (name: string, content: string) =>
    fetch(`/api/routines/${encodeURIComponent(name)}/prompt`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }).then(j<RoutinePrompt>),
  setSchedule: (hour: number, minute: number) =>
    fetch("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hour, minute }),
    }).then(j<{ applied: boolean; detail: string }>),
};
