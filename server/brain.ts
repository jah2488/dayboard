import {
  readAllConnections,
  readConnections,
  readDiscoveries,
  readHidden,
  readTopics,
  writeDiscoveries,
  writeHidden,
} from "./brain-store.ts";
import { getLearning, listLearnings } from "./learnings.ts";
import { listBrainSessions, runningSessionIds } from "./sessions.ts";
import type {
  BrainConnections,
  BrainDiscovery,
  BrainGraph,
  BrainHidden,
  BrainSearchResult,
} from "../shared/types.ts";

export { readConnections as getBrainDoc } from "./brain-store.ts";

// Tags for the Sessions tab are the brain topics already extracted per session
// — no separate tag store. Returns topic labels (falling back to the slug).
function topicLabels(): Map<string, string> {
  return new Map(readTopics().map((t) => [t.slug, t.label]));
}

export function sessionTagMap(): Map<string, string[]> {
  const labels = topicLabels();
  const map = new Map<string, string[]>();
  for (const c of readAllConnections()) {
    if (c.kind !== "session") continue;
    map.set(
      c.id.replace(/^session:/, ""),
      c.topics.map((t) => labels.get(t.slug) ?? t.slug),
    );
  }
  return map;
}

export function sessionTags(id: string): string[] {
  const c = readConnections(`session:${id}`);
  if (!c) return [];
  const labels = topicLabels();
  return c.topics.map((t) => labels.get(t.slug) ?? t.slug);
}

const MAX_SEARCH_DOCS = 40;
const MAX_CONTENT_MATCHES = 3;
const SNIPPET = 120;

const snip = (s: string) => (s.length > SNIPPET ? s.slice(0, SNIPPET) + "…" : s);

// Ids of source docs that exist right now — connections without one are
// "missing"; sources without connections are "unindexed". Uses the Brain's
// eligible-session view (machinery routine runs excluded), so the dashboard's
// own sweep transcripts neither count as unindexed nor render as nodes.
const sourceIds = () =>
  new Set([
    ...listLearnings().map((l) => `learning:${l.file}`),
    ...listBrainSessions().map((s) => `session:${s.id}`),
  ]);

const docCounts = (all: BrainConnections[]) =>
  all
    .flatMap((c) => c.topics.map((t) => t.slug))
    .reduce((m, slug) => m.set(slug, (m.get(slug) ?? 0) + 1), new Map<string, number>());

export function getBrainGraph(): BrainGraph {
  const all = readAllConnections();
  const existing = sourceIds();
  const indexed = new Set(all.map((c) => c.id));
  const counts = docCounts(all);

  // The sweep deliberately skips live sessions, so they never gain a
  // connections file while running — counting them as unindexed would peg the
  // tally at the number of open sessions forever ("N not yet swept" sticks).
  const running = runningSessionIds();
  const sweepable = (id: string) =>
    !id.startsWith("session:") || !running.has(id.slice("session:".length));

  // linksTo across all docs already covers every link once (linkedFrom is the
  // mirror); the Map dedupes any from+to repeats, and links whose target file
  // is gone are dropped so the UI never gets an edge to a nonexistent node.
  const links = [
    ...new Map(
      all.flatMap((c) =>
        c.linksTo
          .filter((l) => indexed.has(l.id))
          .map(
            (l) =>
              [
                `${c.id} ${l.id}`,
                { from: c.id, to: l.id, reason: l.reason, origin: l.origin },
              ] as const,
          ),
      ),
    ).values(),
  ];

  return {
    docs: all.map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      summary: c.summary,
      date: c.date,
      origin: c.origin,
      topics: c.topics,
      missing: !existing.has(c.id),
    })),
    topics: readTopics().map((t) => ({ ...t, docCount: counts.get(t.slug) ?? 0 })),
    links,
    sweptAt: all.reduce<string | null>(
      (max, c) => (max && max >= c.indexedAt ? max : c.indexedAt),
      null,
    ),
    unindexed: [...existing].filter((id) => !indexed.has(id) && sweepable(id)).length,
    hidden: readHidden(),
  };
}

// What the Brain tab shows: active discoveries, freshest reconfirmation first.
export function listDiscoveries(): BrainDiscovery[] {
  return readDiscoveries()
    .filter((d) => d.status === "active")
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

// Dismissal is a permanent tombstone — the record stays in the file so the
// synthesis pass can refuse to resurrect it.
export function dismissDiscovery(id: string): BrainDiscovery | null {
  const all = readDiscoveries();
  const hit = all.find((d) => d.id === id);
  if (!hit) return null;
  const dismissed: BrainDiscovery = { ...hit, status: "dismissed" };
  writeDiscoveries(all.map((d) => (d.id === id ? dismissed : d)));
  return dismissed;
}

// Toggle a doc id or topic slug in/out of the hidden set. Idempotent: hiding an
// already-hidden id (or unhiding an absent one) is a no-op that still returns
// the current set, so the route is safe to retry.
export function setHidden(kind: "doc" | "topic", id: string, hidden: boolean): BrainHidden {
  const current = readHidden();
  const list = kind === "doc" ? current.docs : current.topics;
  const next = hidden
    ? list.includes(id) ? list : [...list, id]
    : list.filter((x) => x !== id);
  const updated: BrainHidden =
    kind === "doc" ? { ...current, docs: next } : { ...current, topics: next };
  writeHidden(updated);
  return updated;
}

// Hiding a discovery is reversible and distinct from dismissal — the record
// stays active, just out of the default list (the UI filters on it).
export function hideDiscovery(id: string, hidden: boolean): BrainDiscovery | null {
  const all = readDiscoveries();
  const hit = all.find((d) => d.id === id);
  if (!hit) return null;
  const next: BrainDiscovery = { ...hit, hidden };
  writeDiscoveries(all.map((d) => (d.id === id ? next : d)));
  return next;
}

export function searchBrain(q: string): BrainSearchResult {
  const needle = q.trim().toLowerCase();
  if (!needle) return { topics: [], docs: [] };

  const all = readAllConnections();
  const counts = docCounts(all);
  const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(needle);

  const topics = readTopics()
    .filter((t) => has(t.slug) || has(t.label) || has(t.description))
    .map((t) => ({ ...t, docCount: counts.get(t.slug) ?? 0 }));

  const byId = new Map<string, BrainSearchResult["docs"][number]>(
    all
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        title: c.title,
        matches: [
          ...(has(c.title) ? [{ field: "title" as const, snippet: snip(c.title) }] : []),
          ...(has(c.summary) ? [{ field: "summary" as const, snippet: snip(c.summary) }] : []),
          ...c.topics
            .filter((t) => has(t.slug) || has(t.excerpt))
            .map((t) => ({ field: "topic" as const, snippet: snip(t.excerpt ?? t.slug) })),
        ],
      }))
      .filter((d) => d.matches.length > 0)
      .map((d) => [d.id, d] as const),
  );

  // Grep the learnings markdown itself, so search reaches inside docs —
  // indexed or not — beyond what the sweep distilled.
  for (const l of listLearnings()) {
    const matches = (getLearning(l.file)?.content ?? "")
      .split("\n")
      .filter((line) => line.toLowerCase().includes(needle))
      .slice(0, MAX_CONTENT_MATCHES)
      .map((line) => ({ field: "content" as const, snippet: snip(line.trim()) }));
    if (!matches.length) continue;
    const id = `learning:${l.file}`;
    const cur = byId.get(id) ?? { id, kind: "learning" as const, title: l.title, matches: [] };
    byId.set(id, { ...cur, matches: [...cur.matches, ...matches] });
  }

  return { topics, docs: [...byId.values()].slice(0, MAX_SEARCH_DOCS) };
}
