// Token / session usage for the Trends tab. Functional core (aggregateUsage)
// is pure and unit-tested; the shell (buildUsage) reads the live session
// parse-cache and the brain's topic connections.

import { sessionUsageRecords } from "./sessions.ts";
import { readAllConnections, readTopics } from "./brain-store.ts";
import { localDate } from "./util.ts";
import type { Usage, UsageRange, UsageTopic } from "../shared/types.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// One session's contribution: when it started, how many tokens, and which
// bucket it falls in (a sweep, your interactive work, or another agent run).
interface UsageRecord {
  startedAt: string | null;
  tokens: number;
  isSweep: boolean;
  origin: "direct" | "agent";
}

type UsageCategory = "interactive" | "agent" | "sweep";

function categorize(r: UsageRecord): UsageCategory {
  if (r.isSweep) return "sweep";
  return r.origin === "direct" ? "interactive" : "agent";
}

// One topic membership tagged with its source doc's date, for in-window tallies.
interface TopicDoc {
  slug: string;
  label: string;
  date: string | null; // YYYY-MM-DD
}

// Bucket granularity per range: 6h for a week, then coarser as the window
// grows so the bar count stays readable.
function bucketHoursFor(range: UsageRange): number {
  return range === "week" ? 6 : range === "month" ? 24 : 168;
}

// Floor a Date to the start of its local time bucket.
function alignLocal(d: Date, hours: number): Date {
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (hours <= 6) b.setHours(Math.floor(d.getHours() / 6) * 6);
  else if (hours === 168) b.setDate(b.getDate() - ((b.getDay() + 6) % 7)); // back to Monday
  // hours === 24 already sits at local midnight
  return b;
}

function stepBucket(d: Date, hours: number): Date {
  const n = new Date(d);
  if (hours <= 6) n.setHours(n.getHours() + 6);
  else if (hours === 24) n.setDate(n.getDate() + 1);
  else n.setDate(n.getDate() + 7);
  return n;
}

function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function rangeStartMs(range: UsageRange, nowMs: number, earliestMs: number): number {
  if (range === "week") return nowMs - 7 * DAY_MS;
  if (range === "month") return nowMs - 30 * DAY_MS;
  return earliestMs; // "all" — from the first session on record
}

export function aggregateUsage(
  records: UsageRecord[],
  topicDocs: TopicDoc[],
  range: UsageRange,
  now: Date,
): Usage {
  const nowMs = now.getTime();
  const starts = records
    .map((r) => parseMs(r.startedAt))
    .filter((ms): ms is number => ms !== null);
  const earliestMs = starts.length ? Math.min(...starts) : nowMs;
  const sinceMs = rangeStartMs(range, nowMs, earliestMs);
  const sinceDate = localDate(new Date(sinceMs));
  const nowDate = localDate(now);
  const hours = bucketHoursFor(range);

  const inWindow = records.filter((r) => {
    const ms = parseMs(r.startedAt);
    return ms !== null && ms >= sinceMs && ms <= nowMs;
  });

  // Contiguous buckets (zeros included) so the time axis reads honestly.
  type Cell = { interactiveTokens: number; agentTokens: number; sweepTokens: number };
  const bucketIndex = new Map<number, Cell>();
  const order: number[] = [];
  let cursor = alignLocal(new Date(sinceMs), hours);
  for (let guard = 0; cursor.getTime() <= nowMs && guard < 20_000; guard++) {
    const key = cursor.getTime();
    bucketIndex.set(key, { interactiveTokens: 0, agentTokens: 0, sweepTokens: 0 });
    order.push(key);
    cursor = stepBucket(cursor, hours);
  }

  let totalTokens = 0;
  let interactiveTokens = 0;
  let agentTokens = 0;
  let sweepTokens = 0;
  for (const r of inWindow) {
    const ms = parseMs(r.startedAt)!;
    const cat = categorize(r);
    const cell = bucketIndex.get(alignLocal(new Date(ms), hours).getTime());
    if (cell) cell[`${cat}Tokens`] += r.tokens;
    totalTokens += r.tokens;
    if (cat === "interactive") interactiveTokens += r.tokens;
    else if (cat === "agent") agentTokens += r.tokens;
    else sweepTokens += r.tokens;
  }

  const buckets = order.map((key) => {
    const c = bucketIndex.get(key)!;
    return { start: new Date(key).toISOString(), ...c };
  });

  // Sessions per local day (contiguous) — interactive sessions only, the count
  // that matters (subagent transcripts are not sessions the user started).
  const interactive = inWindow.filter((r) => categorize(r) === "interactive");
  const perDay = new Map<string, number>();
  for (const r of interactive) {
    const d = localDate(new Date(parseMs(r.startedAt)!));
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const sessionsPerDay: Usage["sessionsPerDay"] = [];
  for (
    let day = new Date(sinceMs);
    localDate(day) <= nowDate && sessionsPerDay.length < 5_000;
    day = new Date(day.getTime() + DAY_MS)
  ) {
    const d = localDate(day);
    sessionsPerDay.push({ date: d, sessions: perDay.get(d) ?? 0 });
  }

  // Top 3 topics by in-window doc count (null-dated docs only count for "all").
  const topicCount = new Map<string, { label: string; docs: number }>();
  for (const t of topicDocs) {
    const inRange = t.date ? t.date >= sinceDate && t.date <= nowDate : range === "all";
    if (!inRange) continue;
    const cur = topicCount.get(t.slug) ?? { label: t.label, docs: 0 };
    cur.docs += 1;
    topicCount.set(t.slug, cur);
  }
  const topTopics: UsageTopic[] = [...topicCount.entries()]
    .map(([slug, v]) => ({ slug, label: v.label, docs: v.docs }))
    .sort((a, b) => b.docs - a.docs || a.label.localeCompare(b.label))
    .slice(0, 3);

  return {
    range,
    bucketHours: hours,
    buckets,
    sessionsPerDay,
    topTopics,
    totals: {
      totalTokens,
      interactiveTokens,
      agentTokens,
      sweepTokens,
      sweepShare: totalTokens > 0 ? sweepTokens / totalTokens : 0,
      sessions: interactive.length,
      agentRuns: inWindow.length - interactive.length,
    },
  };
}

function topicDocs(): TopicDoc[] {
  const labels = new Map(readTopics().map((t) => [t.slug, t.label]));
  const out: TopicDoc[] = [];
  for (const c of readAllConnections()) {
    for (const t of c.topics) {
      out.push({ slug: t.slug, label: labels.get(t.slug) ?? t.slug, date: c.date });
    }
  }
  return out;
}

export function buildUsage(range: UsageRange = "week"): Usage {
  return aggregateUsage(sessionUsageRecords(), topicDocs(), range, new Date());
}
