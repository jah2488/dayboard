// Pure decision logic for the discoveries synthesis pass — functional core,
// no I/O, no clock (callers pass `now`). brain-sweep.ts feeds it the parsed
// synthesis reply and persists whatever comes back.

import { z } from "zod";
import type { BrainDiscovery, BrainVerification } from "../shared/types.ts";

// A hypothesis nobody has researched yet — newborn discoveries, reset ones,
// and legacy records brain-store normalizes on read all start here. Frozen:
// it's assigned by reference to many records, so mutation must be loud.
export const PENDING_VERIFICATION: BrainVerification = Object.freeze({
  status: "pending",
  verdict: null,
  detail: "",
  evidence: [],
  checkedAt: null,
});

export const synthesisReplySchema = z.object({
  discoveries: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum([
          "trend",
          "thread",
          "pattern",
          "fix",
          "correlation",
          "contradiction",
          "silence",
        ]),
        title: z.string(),
        insight: z.string(),
        topics: z.array(z.string()).default([]),
        docs: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});
export type SynthesisReply = z.infer<typeof synthesisReplySchema>;

export const verificationReplySchema = z.object({
  verdict: z.enum(["confirmed", "partial", "refuted", "inconclusive"]),
  detail: z.string(),
  evidence: z
    .array(
      z.object({
        source: z.string(),
        summary: z.string(),
        ref: z.string().nullish(),
        supports: z.boolean(),
      }),
    )
    .default([]),
});
export type VerificationReply = z.infer<typeof verificationReplySchema>;

export interface DiscoveryMergeResult {
  discoveries: BrainDiscovery[];
  newDiscoveries: number;
}

const MAX_ACTIVE = 12;
// The scarce, high-value insights. They claim slots before threads/trends so a
// crowd of re-confirmed workstreams can never evict a real cross-cutting find —
// the starvation the synthesis prompt's restraint bias used to cause.
const CROSS_CUTTING_KINDS: ReadonlySet<BrainDiscovery["kind"]> = new Set([
  "correlation",
  "contradiction",
  "silence",
]);
const MAX_DOCS = 8;
// An insight with fewer than two evidence docs is noise, not a discovery.
const MIN_DOCS = 2;
const MAX_TOPICS = 5;
const MAX_TITLE = 90;
const MAX_INSIGHT = 600;
const MAX_EVIDENCE = 10;
const MAX_EVIDENCE_SUMMARY = 300;
const MAX_DETAIL = 4000;

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// claude -p wraps its JSON in prose/fences often enough to make this the rule.
function extractJsonObject(out: string, what: string): unknown {
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`No JSON object in the ${what} reply.`);
  return JSON.parse(out.slice(start, end + 1));
}

export function parseSynthesisReply(out: string): SynthesisReply {
  return synthesisReplySchema.parse(extractJsonObject(out, "synthesis"));
}

export function parseVerificationReply(out: string): VerificationReply {
  return verificationReplySchema.parse(extractJsonObject(out, "verification"));
}

// The reply IS the new active set: same id = update (firstSeen survives),
// new id = new, omitted = retired. Dismissed records pass through untouched
// and their ids can never come back.
export function mergeDiscoveries(
  existing: BrainDiscovery[],
  reply: SynthesisReply,
  validDocIds: Set<string>,
  validTopicSlugs: Set<string>,
  now: string,
): DiscoveryMergeResult {
  const dismissed = existing.filter((d) => d.status === "dismissed");
  const tombstoned = new Set(dismissed.map((d) => d.id));
  const previous = new Map(
    existing.filter((d) => d.status === "active").map((d) => [d.id, d]),
  );

  const merged = new Map<string, BrainDiscovery>();
  for (const raw of reply.discoveries) {
    const id = slugify(raw.id);
    if (!id || tombstoned.has(id) || merged.has(id)) continue;
    const docs = [...new Set(raw.docs)].filter((d) => validDocIds.has(d)).slice(0, MAX_DOCS);
    if (docs.length < MIN_DOCS) continue;
    const prior = previous.get(id);
    const insight = cap(raw.insight.trim(), MAX_INSIGHT);
    merged.set(id, {
      id,
      kind: raw.kind,
      title: cap(raw.title.trim(), MAX_TITLE),
      insight,
      topics: [...new Set(raw.topics)].filter((t) => validTopicSlugs.has(t)).slice(0, MAX_TOPICS),
      docs,
      status: "active",
      // Hidden is a reversible user choice (≠ dismissed): new records show by
      // default, updates keep whatever the user set.
      hidden: prior?.hidden ?? false,
      firstSeen: prior?.firstSeen ?? now,
      lastSeen: now,
      // Research answers a specific insight text. Once that text moves the
      // hypothesis moved, so the old verdict is stale and it re-queues; an
      // unchanged insight keeps its verification verbatim.
      verification:
        prior && prior.insight === insight ? prior.verification : PENDING_VERIFICATION,
    });
  }

  // Cross-cutting kinds fill the cap first, then threads/trends/fixes take what
  // remains — both groups newest-first. Same MAX_ACTIVE ceiling overall; the
  // ordering just guarantees a real correlation/contradiction/silence outranks
  // the Nth re-confirmed thread instead of being sliced off behind it.
  const byRecency = (a: BrainDiscovery, b: BrainDiscovery) =>
    b.lastSeen.localeCompare(a.lastSeen);
  const all = [...merged.values()];
  const active = [
    ...all.filter((d) => CROSS_CUTTING_KINDS.has(d.kind)).sort(byRecency),
    ...all.filter((d) => !CROSS_CUTTING_KINDS.has(d.kind)).sort(byRecency),
  ].slice(0, MAX_ACTIVE);

  return {
    discoveries: [...active, ...dismissed],
    newDiscoveries: active.filter((d) => !previous.has(d.id)).length,
  };
}

// Land a finished research run on its discovery: status done, capped fields,
// sources normalized to slugs so the UI can group/badge them.
export function applyVerification(
  discovery: BrainDiscovery,
  reply: VerificationReply,
  now: string,
): BrainDiscovery {
  return {
    ...discovery,
    verification: {
      status: "done",
      verdict: reply.verdict,
      detail: cap(reply.detail.trim(), MAX_DETAIL),
      evidence: reply.evidence.slice(0, MAX_EVIDENCE).map((e) => ({
        source: slugify(e.source),
        summary: cap(e.summary.trim(), MAX_EVIDENCE_SUMMARY),
        ref: e.ref ?? null,
        supports: e.supports,
      })),
      checkedAt: now,
    },
  };
}
