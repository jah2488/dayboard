// Pure decision logic for the topic-summary pass — functional core, no I/O,
// no clock. brain-sweep.ts computes each topic's membership, asks this module
// for the fingerprint, and only calls Claude when the fingerprint drifts; the
// parsed reply comes back here to be capped onto the topic.

import { z } from "zod";
import type { BrainTopic } from "../shared/types.ts";

// A topic's summary is one short paragraph; the prompt targets ~4 sentences,
// so this is headroom, not the spec. The cap trims at a SENTENCE boundary —
// a hard mid-word slice (the old behaviour) read as "cut off".
const MAX_SUMMARY = 1000;

const SENTENCE_END = /[.!?]["')\]]?(?=\s|$)/g;

// Trim to the last complete sentence that fits in n chars; fall back to a hard
// slice only if there's no sentence break at all (one runaway sentence).
function capToSentence(text: string, n: number): string {
  const s = text.trim();
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  let lastEnd = -1;
  for (const m of head.matchAll(SENTENCE_END)) lastEnd = m.index + m[0].length;
  return (lastEnd > 0 ? head.slice(0, lastEnd) : head).trim();
}

// A stable signature of a topic's current members: every member's id paired
// with the indexedAt it was last seen at, sorted so order can't move it. It
// shifts when a doc joins/leaves the topic OR when a member re-indexes (its
// indexedAt advances) — exactly the cases that make the stored summary stale.
export function topicFingerprint(
  members: Array<{ id: string; indexedAt: string }>,
): string {
  return members
    .map((m) => `${m.id}:${m.indexedAt}`)
    .sort()
    .join("|");
}

export const topicSummaryReplySchema = z.object({ summary: z.string() });
export type TopicSummaryReply = z.infer<typeof topicSummaryReplySchema>;

// claude -p wraps its JSON in prose/fences often enough to make brace
// extraction the rule (mirrors brain-discover's extractJsonObject).
export function parseTopicSummaryReply(out: string): TopicSummaryReply {
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in the topic-summary reply.");
  return topicSummaryReplySchema.parse(JSON.parse(out.slice(start, end + 1)));
}

// Land a generated summary on its topic: trimmed, capped, stamped with the
// fingerprint of the member set it was written from (so the next sweep can
// tell whether it still holds).
export function applyTopicSummary(
  topic: BrainTopic,
  summaryText: string,
  fingerprint: string,
): BrainTopic {
  return { ...topic, summary: capToSentence(summaryText, MAX_SUMMARY), summaryFingerprint: fingerprint };
}
