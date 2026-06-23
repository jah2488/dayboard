import { describe, expect, it } from "vitest";
import {
  applyTopicSummary,
  parseTopicSummaryReply,
  topicFingerprint,
} from "./brain-topic.ts";
import type { BrainTopic } from "../shared/types.ts";

const topic = (over: Partial<BrainTopic> = {}): BrainTopic => ({
  slug: "project-alpha",
  label: "Project Alpha",
  description: "Project Alpha partner work",
  summary: "",
  summaryFingerprint: "",
  ...over,
});

const A = "learning:a.md";
const B = "learning:b.md";
const T1 = "2026-06-10T07:00:00.000Z";
const T2 = "2026-06-11T07:00:00.000Z";

describe("topicFingerprint", () => {
  it("is deterministic and independent of member order", () => {
    const forward = topicFingerprint([
      { id: A, indexedAt: T1 },
      { id: B, indexedAt: T2 },
    ]);
    const reversed = topicFingerprint([
      { id: B, indexedAt: T2 },
      { id: A, indexedAt: T1 },
    ]);
    expect(forward).toBe(reversed);
    expect(forward).toBe(topicFingerprint([{ id: A, indexedAt: T1 }, { id: B, indexedAt: T2 }]));
  });

  it("changes when a member is added", () => {
    const before = topicFingerprint([{ id: A, indexedAt: T1 }]);
    const after = topicFingerprint([{ id: A, indexedAt: T1 }, { id: B, indexedAt: T2 }]);
    expect(after).not.toBe(before);
  });

  it("changes when a member is removed", () => {
    const before = topicFingerprint([{ id: A, indexedAt: T1 }, { id: B, indexedAt: T2 }]);
    const after = topicFingerprint([{ id: A, indexedAt: T1 }]);
    expect(after).not.toBe(before);
  });

  it("changes when a member is re-indexed (its indexedAt advances)", () => {
    const before = topicFingerprint([{ id: A, indexedAt: T1 }]);
    const after = topicFingerprint([{ id: A, indexedAt: T2 }]);
    expect(after).not.toBe(before);
  });

  it("is empty for a topic with no members", () => {
    expect(topicFingerprint([])).toBe("");
  });
});

describe("parseTopicSummaryReply", () => {
  it("extracts the JSON object from surrounding prose/fences", () => {
    const reply = 'Sure:\n```json\n{"summary":"Key findings across the docs."}\n```';
    expect(parseTopicSummaryReply(reply)).toEqual({ summary: "Key findings across the docs." });
  });

  it("extracts a bare object embedded in prose", () => {
    expect(parseTopicSummaryReply('Here you go {"summary":"A synthesis."} done.')).toEqual({
      summary: "A synthesis.",
    });
  });

  it("rejects replies with no JSON object or the wrong shape", () => {
    expect(() => parseTopicSummaryReply("nope")).toThrow(/No JSON object/);
    expect(() => parseTopicSummaryReply('{"summary":42}')).toThrow();
  });
});

describe("applyTopicSummary", () => {
  it("trims the summary and stamps the new fingerprint", () => {
    const t = applyTopicSummary(topic(), "  A synthesized paragraph.  ", "fp-1");
    expect(t.summary).toBe("A synthesized paragraph.");
    expect(t.summaryFingerprint).toBe("fp-1");
  });

  it("trims an overlong summary at a sentence boundary, never mid-word", () => {
    // Four sentences, ~330 chars each: the cap (1000) lands inside the 4th, so
    // the result keeps the first three whole and never ends mid-sentence.
    const sentence = (n: number) => `Sentence ${n} ${"word ".repeat(60)}done.`;
    const long = [1, 2, 3, 4].map(sentence).join(" ");
    const t = applyTopicSummary(topic(), long, "fp");
    expect(t.summary.length).toBeLessThanOrEqual(1000);
    expect(t.summary.endsWith("done.")).toBe(true); // a complete sentence
    expect(t.summary).not.toContain("Sentence 4"); // the overflowing one is dropped
  });

  it("hard-trims only when there is no sentence break to cut at", () => {
    const t = applyTopicSummary(topic(), "x".repeat(1200), "fp");
    expect(t.summary).toHaveLength(1000);
  });

  it("leaves the topic's other fields untouched", () => {
    const t = applyTopicSummary(topic({ label: "Project Alpha!", description: "d" }), "s", "fp");
    expect(t).toMatchObject({ slug: "project-alpha", label: "Project Alpha!", description: "d" });
  });

  it("clears the summary when handed empty text and an empty fingerprint", () => {
    const t = applyTopicSummary(topic({ summary: "old", summaryFingerprint: "old-fp" }), "", "");
    expect(t.summary).toBe("");
    expect(t.summaryFingerprint).toBe("");
  });
});
