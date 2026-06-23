// Pure decision logic for the brain sweep — functional core, no I/O, no clock
// (callers pass `now`). brain-sweep.ts feeds it validated batch replies and
// persists whatever comes back. Records are cloned on write, so the shell can
// detect what changed by object identity and persist only that.

import { z } from "zod";
import type {
  BrainConnections,
  BrainDocKind,
  BrainLinkOrigin,
  BrainTopic,
  BrainTopicRef,
  SessionOrigin,
} from "../shared/types.ts";

export const batchReplySchema = z.object({
  docs: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      // Anything that isn't a bare YYYY-MM-DD degrades to null (the source
      // doc's own date wins) rather than failing the whole batch.
      date: z
        .string()
        .nullish()
        .transform((d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null)),
      topics: z
        .array(
          z.object({
            slug: z.string(),
            label: z.string().nullish(),
            description: z.string().nullish(),
            strength: z.number(),
            excerpt: z.string().nullish(),
          }),
        )
        .default([]),
      links: z
        .array(z.object({ id: z.string(), reason: z.string() }))
        .default([]),
    }),
  ),
});
export type BatchReply = z.infer<typeof batchReplySchema>;

export interface MergeState {
  connections: Map<string, BrainConnections>;
  topics: BrainTopic[];
}

export interface DocMeta {
  kind: BrainDocKind;
  title: string;
  date: string | null;
  // Learnings are user-authored, so always "direct"; sessions carry the
  // origin derived from their transcript entrypoint.
  origin: SessionOrigin;
  sourceMtime: number;
}

export interface ArtifactLink {
  from: string;
  to: string;
  reason: string;
}

export interface MergeResult extends MergeState {
  newTopics: number;
  newLinks: number;
}

const MAX_TOPICS_PER_DOC = 6;
// Deliberately looser than the limits the prompt asks for (200/120) — a
// forgiveness margin for a model that slightly overruns, not the spec.
const MAX_EXCERPT = 240;
const MAX_REASON = 160;

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pair = (from: string, to: string) => `${from}\u0000${to}`;

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const humanize = (slug: string) =>
  slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function parseBatchReply(out: string): BatchReply {
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in the sweep reply.");
  return batchReplySchema.parse(JSON.parse(out.slice(start, end + 1)));
}

export function applyBatch(
  state: MergeState,
  batch: BatchReply,
  meta: Map<string, DocMeta>,
  artifactLinks: ArtifactLink[],
  now: string,
): MergeResult {
  // The model occasionally invents doc ids; only docs we actually handed out
  // (present in meta) are mergeable.
  const docs = batch.docs.filter((d) => meta.has(d.id));
  const ids = new Set(docs.map((d) => d.id));

  const { topics, newTopics } = registerTopics(state.topics, docs);

  // Re-indexing replaces a doc's outbound links wholesale: retract the previous
  // ones from every target's linkedFrom before applying the fresh set.
  const connections = new Map(
    [...state.connections].map(([id, conn]) => [id, withoutLinkedFrom(conn, ids)] as const),
  );
  for (const d of docs) {
    const m = meta.get(d.id)!;
    connections.set(d.id, {
      id: d.id,
      kind: m.kind,
      title: m.title,
      date: d.date ?? m.date,
      summary: d.summary.trim(),
      origin: m.origin,
      topics: docTopics(d.topics),
      linksTo: [],
      linkedFrom: connections.get(d.id)?.linkedFrom ?? [],
      sourceMtime: m.sourceMtime,
      indexedAt: now,
    });
  }

  // Artifact links go first so deterministic ground truth wins the from→to
  // slot over whatever the model proposed for the same pair.
  const proposed = [
    ...artifactLinks.map((l) => ({ ...l, origin: "artifact" as BrainLinkOrigin })),
    ...docs.flatMap((d) =>
      d.links.map((l) => ({ from: d.id, to: l.id, reason: l.reason, origin: "ai" as BrainLinkOrigin })),
    ),
  ];
  const prior = new Set(
    [...state.connections.values()].flatMap((c) => c.linksTo.map((l) => pair(c.id, l.id))),
  );
  const seen = new Set<string>();
  let newLinks = 0;
  for (const l of proposed) {
    const ok =
      l.from !== l.to && ids.has(l.from) && connections.has(l.to) && !seen.has(pair(l.from, l.to));
    if (!ok) continue;
    seen.add(pair(l.from, l.to));
    link(connections, { ...l, reason: cap(l.reason, MAX_REASON) });
    if (!prior.has(pair(l.from, l.to))) newLinks++;
  }

  return { connections, topics, newTopics, newLinks };
}

// Same retraction as a re-index, for a source doc that no longer exists:
// drop its record and scrub every reference to it, both directions.
export function removeDoc(state: MergeState, id: string): MergeState {
  const connections = new Map(
    [...state.connections]
      .filter(([key]) => key !== id)
      .map(([key, conn]) => [key, withoutRefsTo(conn, id)] as const),
  );
  return { connections, topics: state.topics };
}

function registerTopics(
  existing: BrainTopic[],
  docs: BatchReply["docs"],
): { topics: BrainTopic[]; newTopics: number } {
  const bySlug = new Map(existing.map((t) => [t.slug, t]));
  for (const d of docs)
    for (const t of d.topics) {
      const slug = slugify(t.slug);
      if (!slug || bySlug.has(slug)) continue;
      // A new topic starts unsummarized; the sweep's topic-summary pass fills
      // summary + summaryFingerprint once its membership is final. Existing
      // topics pass through untouched above, so a re-index never wipes one.
      bySlug.set(slug, {
        slug,
        label: t.label?.trim() || humanize(slug),
        description: t.description ?? "",
        summary: "",
        summaryFingerprint: "",
      });
    }
  return { topics: [...bySlug.values()], newTopics: bySlug.size - existing.length };
}

function docTopics(refs: BatchReply["docs"][number]["topics"]): BrainTopicRef[] {
  const bySlug = new Map<string, BrainTopicRef>();
  for (const r of refs) {
    const slug = slugify(r.slug);
    if (!slug) continue;
    const ref = {
      slug,
      strength: clamp01(r.strength),
      excerpt: r.excerpt ? cap(r.excerpt, MAX_EXCERPT) : null,
    };
    const cur = bySlug.get(slug);
    if (!cur || ref.strength > cur.strength) bySlug.set(slug, ref);
  }
  return [...bySlug.values()]
    .sort((a, b) => b.strength - a.strength || a.slug.localeCompare(b.slug))
    .slice(0, MAX_TOPICS_PER_DOC);
}

function link(
  connections: Map<string, BrainConnections>,
  l: { from: string; to: string; reason: string; origin: BrainLinkOrigin },
): void {
  const from = connections.get(l.from)!;
  const to = connections.get(l.to)!;
  connections.set(l.from, {
    ...from,
    linksTo: [...from.linksTo, { id: l.to, reason: l.reason, origin: l.origin }],
  });
  connections.set(l.to, {
    ...to,
    linkedFrom: [...to.linkedFrom, { id: l.from, reason: l.reason, origin: l.origin }],
  });
}

function withoutLinkedFrom(conn: BrainConnections, sources: Set<string>): BrainConnections {
  if (!conn.linkedFrom.some((l) => sources.has(l.id))) return conn;
  return { ...conn, linkedFrom: conn.linkedFrom.filter((l) => !sources.has(l.id)) };
}

function withoutRefsTo(conn: BrainConnections, id: string): BrainConnections {
  const touched =
    conn.linksTo.some((l) => l.id === id) || conn.linkedFrom.some((l) => l.id === id);
  if (!touched) return conn;
  return {
    ...conn,
    linksTo: conn.linksTo.filter((l) => l.id !== id),
    linkedFrom: conn.linkedFrom.filter((l) => l.id !== id),
  };
}
