import { Hono } from "hono";
import * as repo from "./repo.ts";
import { getLearning, listLearnings } from "./learnings.ts";
import { getSession, listSessions, summarizeSession } from "./sessions.ts";
import { backfillSessionTags } from "./session-tags.ts";
import {
  dismissDiscovery,
  getBrainDoc,
  getBrainGraph,
  hideDiscovery,
  listDiscoveries,
  searchBrain,
  sessionTagMap,
  sessionTags,
  setHidden,
} from "./brain.ts";
import { getBrainSweep, startBrainSweep, verifyOne } from "./brain-sweep.ts";
import { surfaceOverlap } from "./brain-overlap.ts";
import { startSweep } from "./sweep.ts";
import { listOpenPrs, refreshOpenPrs } from "./github-prs.ts";
import { buildDayView, ensureEdition } from "./views.ts";
import { buildInsights } from "./insights.ts";
import { buildUsage } from "./usage.ts";
import { writeSnapshot } from "./snapshot.ts";
import {
  checkConfig,
  getConfig,
  hasConfigFile,
  resolveRoutinePrompt,
  saveConfig,
  writeRoutineOverride,
} from "./config.ts";
import { applySchedule } from "./schedule.ts";
import type { SectionSource } from "../shared/types.ts";

export const api = new Hono();

// Refresh the today.json snapshot after any mutating request.
api.use("*", async (c, next) => {
  await next();
  const m = c.req.method;
  if ((m === "POST" || m === "PATCH" || m === "DELETE") && c.res.ok) {
    writeSnapshot();
  }
});

// ---- learnings (reference docs) ----
api.get("/learnings", (c) => c.json(listLearnings()));
api.get("/learnings/:file", (c) => {
  const doc = getLearning(c.req.param("file"));
  return doc ? c.json(doc) : c.json({ error: "not found" }, 404);
});

// ---- claude code sessions ----
// Tags (brain topics) are joined in at the boundary so sessions.ts stays free
// of any brain dependency.
api.get("/sessions", (c) => {
  const tags = sessionTagMap();
  return c.json(listSessions().map((s) => ({ ...s, tags: tags.get(s.id) ?? [] })));
});
api.get("/sessions/:id", (c) => {
  const id = c.req.param("id");
  const d = getSession(id);
  return d ? c.json({ ...d, tags: sessionTags(id) }) : c.json({ error: "not found" }, 404);
});
// Cheap catch-up: tag untagged INTERACTIVE sessions only (one Haiku call each).
// Synchronous — the untagged set is small; the client shows a spinner.
api.post("/sessions/tag-backfill", async (c) => {
  try {
    return c.json(await backfillSessionTags());
  } catch (e) {
    return c.json({ error: String(e instanceof Error ? e.message : e) }, 502);
  }
});
api.post("/sessions/:id/summarize", async (c) => {
  try {
    const s = await summarizeSession(c.req.param("id"));
    return s ? c.json(s) : c.json({ error: "not found" }, 404);
  } catch (e) {
    return c.json({ error: String(e instanceof Error ? e.message : e) }, 502);
  }
});

// ---- brain (knowledge graph) ----
api.get("/brain", (c) => c.json(getBrainGraph()));
api.get("/brain/search", (c) => c.json(searchBrain(c.req.query("q") ?? "")));
api.get("/brain/sweep", (c) => c.json(getBrainSweep()));
api.post("/brain/sweep", async (c) => {
  const b = await c.req
    .json<{ force?: boolean }>()
    .catch(() => ({}) as { force?: boolean });
  return c.json(startBrainSweep({ force: !!b.force }), 202);
});
api.get("/brain/doc/:id", (c) => {
  const doc = getBrainDoc(c.req.param("id"));
  return doc ? c.json(doc) : c.json({ error: "not found" }, 404);
});
// Hide/show a doc or topic in the graph — reversible, never deletes. The UI
// ghosts hidden ids under a toggle, so the graph still returns them.
api.post("/brain/hide", async (c) => {
  const b = await c.req
    .json<{ kind?: string; id?: string; hidden?: boolean }>()
    .catch(() => ({}) as { kind?: string; id?: string; hidden?: boolean });
  if ((b.kind !== "doc" && b.kind !== "topic") || !b.id) {
    return c.json({ error: "kind ('doc'|'topic') and id required" }, 400);
  }
  return c.json(setHidden(b.kind, b.id, !!b.hidden));
});

// Surface overlap: focused synthesis of 2+ selected topics. Synchronous (one
// claude call, like the session summarizer) — the client shows a spinner.
api.post("/brain/overlap", async (c) => {
  const b = await c.req
    .json<{ topics?: string[] }>()
    .catch(() => ({}) as { topics?: string[] });
  if (!Array.isArray(b.topics) || b.topics.length < 2) {
    return c.json({ error: "topics (array of 2+ slugs) required" }, 400);
  }
  try {
    return c.json(await surfaceOverlap(b.topics));
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    // "pick at least two" / "two or more known" are caller errors -> 400
    return c.json({ error: msg }, /two or more|at least two/.test(msg) ? 400 : 502);
  }
});

api.get("/brain/discoveries", (c) => c.json(listDiscoveries()));
api.post("/brain/discoveries/:id/dismiss", (c) => {
  const d = dismissDiscovery(c.req.param("id"));
  return d ? c.json(d) : c.json({ error: "not found" }, 404);
});
api.post("/brain/discoveries/:id/hide", async (c) => {
  const b = await c.req.json<{ hidden?: boolean }>().catch(() => ({}) as { hidden?: boolean });
  const d = hideDiscovery(c.req.param("id"), !!b.hidden);
  return d ? c.json(d) : c.json({ error: "not found" }, 404);
});
// Fire-and-forget: the record comes back already flipped to "running"; the
// client polls the discoveries list for the outcome.
api.post("/brain/discoveries/:id/verify", (c) => {
  const v = verifyOne(c.req.param("id"));
  if (v.status === "unknown") return c.json({ error: "not found" }, 404);
  if (v.status === "conflict") return c.json({ error: "verification already running" }, 409);
  v.settled.catch((e) => console.error("[brain-verify]", e));
  return c.json(v.record, 202);
});

// ---- day view ----
api.get("/days/:date", (c) => {
  const e = c.req.query("edition");
  return c.json(buildDayView(c.req.param("date"), e ? Number(e) : undefined));
});

// ---- insights (trends + upcoming) ----
api.get("/insights", (c) => {
  const d = c.req.query("date");
  return c.json(buildInsights(d ?? undefined));
});

// ---- token / session usage (Trends tab usage charts) ----
api.get("/usage", (c) => {
  const r = c.req.query("range");
  const range = r === "month" || r === "all" ? r : "week";
  return c.json(buildUsage(range));
});

// ---- config (the admin panel) ----
// The four brain prompts aren't toggleable sweep routines, but they're part of
// "the prompts the sweep runs", so the admin panel can view/edit them too.
const BRAIN_PROMPTS = ["brain-sweep", "brain-discoveries", "brain-topic", "brain-verify"];

// Cheap first-run signal: has the user saved a config file yet? Drives the
// in-app onboarding (no file = first run).
api.get("/config/status", (c) => c.json({ configured: hasConfigFile() }));

api.get("/config", (c) => c.json(getConfig()));

// Merge a partial config patch (what the admin toggles/edits send).
api.patch("/config", async (c) => {
  const patch = await c.req.json().catch(() => null);
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return c.json({ error: "body must be a config object" }, 400);
  }
  return c.json(saveConfig(patch));
});

// Setup-check diagnostics ("test my setup").
api.get("/config/check", (c) => c.json(checkConfig()));

// All sweep prompts, resolved (override -> template) and rendered, grouped so
// the admin can review and edit each one.
api.get("/routines", (c) =>
  c.json({
    sweep: getConfig().routines.map((r) => resolveRoutinePrompt(r.name)),
    brain: BRAIN_PROMPTS.map((name) => resolveRoutinePrompt(name)),
  }),
);
api.get("/routines/:name/prompt", (c) => c.json(resolveRoutinePrompt(c.req.param("name"))));
// Save (or clear, when blank) a routine's local prompt override.
api.put("/routines/:name/prompt", async (c) => {
  const b = await c.req.json<{ content?: string }>().catch(() => ({}) as { content?: string });
  if (typeof b.content !== "string") return c.json({ error: "content (string) required" }, 400);
  return c.json(writeRoutineOverride(c.req.param("name"), b.content));
});

// Update the morning-sweep time: persist to config, then live-rewrite + reload
// the launchd agent (macOS). Returns whether the agent was actually reloaded.
api.post("/schedule", async (c) => {
  const b = await c.req
    .json<{ hour?: number; minute?: number }>()
    .catch(() => ({}) as { hour?: number; minute?: number });
  const hour = Number(b.hour);
  const minute = Number(b.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return c.json({ error: "hour must be 0–23" }, 400);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return c.json({ error: "minute must be 0–59" }, 400);
  }
  saveConfig({ schedule: { hour, minute } });
  return c.json(applySchedule(hour, minute));
});

// ---- sweep (run routines -> new edition) ----
api.post("/sweep", async (c) => {
  const b = await c.req
    .json<{ date?: string; label?: string; trigger?: string }>()
    .catch(() => ({}) as { date?: string; label?: string; trigger?: string });
  if (!b.date) return c.json({ error: "date required" }, 400);
  const trigger = b.trigger === "morning" ? "morning" : "manual";
  return c.json(startSweep({ date: b.date, label: b.label, trigger }), 202);
});

// ---- github PRs (the PRs tab) ----
// Refreshed deterministically each sweep; this endpoint serves the stored set.
api.get("/github/prs", (c) => c.json(listOpenPrs()));
// Manual "refresh now" — runs the same gh fetch the sweep uses. Synchronous
// (a handful of gh calls); returns the fresh set or a 502 if gh fails.
api.post("/github/prs/refresh", (c) => {
  try {
    refreshOpenPrs();
    return c.json(listOpenPrs());
  } catch (e) {
    return c.json({ error: String(e instanceof Error ? e.message : e) }, 502);
  }
});

// ---- sections ----
// Add a card to a day's newest edition (creating one if needed). Lets Claude
// push a custom section onto the board.
api.post("/sections", async (c) => {
  const b = await c.req.json<{
    date?: string;
    source?: SectionSource;
    title?: string;
    bodyMd?: string;
  }>();
  const title = (b.title ?? "").trim();
  if (!title) return c.json({ error: "title required" }, 400);
  const date = b.date ?? new Date().toISOString().slice(0, 10);
  const editionId = ensureEdition(date);
  const existing = repo.getSectionsByEdition(editionId);
  return c.json(
    repo.createSection({
      editionId,
      date,
      source: b.source ?? "morning-brief",
      title,
      bodyMd: b.bodyMd ?? "",
      sort: existing.length,
    }),
    201,
  );
});

api.post("/sections/:id/dismiss", (c) => {
  const s = repo.setSectionStatus(Number(c.req.param("id")), "done");
  return s ? c.json(s) : c.json({ error: "not found" }, 404);
});
api.post("/sections/:id/reopen", (c) => {
  const s = repo.setSectionStatus(Number(c.req.param("id")), "active");
  return s ? c.json(s) : c.json({ error: "not found" }, 404);
});

// ---- tasks ----
api.post("/tasks", async (c) => {
  const b = await c.req.json<{
    title?: string;
    notes?: string | null;
    isCurrent?: boolean;
    sourceSectionId?: number | null;
    sourceDate?: string | null;
    dueDate?: string | null;
  }>();
  const title = (b.title ?? "").trim();
  if (!title) return c.json({ error: "title required" }, 400);
  return c.json(repo.createTask({ ...b, title }), 201);
});

api.post("/tasks/:id/current", (c) => {
  const t = repo.setCurrent(Number(c.req.param("id")));
  return t ? c.json(t) : c.json({ error: "not found" }, 404);
});
api.post("/tasks/:id/unpin", (c) => {
  const t = repo.unpin(Number(c.req.param("id")));
  return t ? c.json(t) : c.json({ error: "not found" }, 404);
});
api.post("/tasks/:id/complete", (c) => {
  const t = repo.completeTask(Number(c.req.param("id")));
  return t ? c.json(t) : c.json({ error: "not found" }, 404);
});
api.post("/tasks/:id/reopen", (c) => {
  const t = repo.reopenTask(Number(c.req.param("id")));
  return t ? c.json(t) : c.json({ error: "not found" }, 404);
});
api.delete("/tasks/:id", (c) => {
  const t = repo.deleteTask(Number(c.req.param("id")));
  return t ? c.json(t) : c.json({ error: "not found" }, 404);
});
api.patch("/tasks/:id", async (c) => {
  const b = await c.req.json<{
    title?: string;
    notes?: string | null;
    dueDate?: string | null;
  }>();
  const t = repo.updateTask(Number(c.req.param("id")), b);
  return t ? c.json(t) : c.json({ error: "not found" }, 404);
});
