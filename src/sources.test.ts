import { describe, expect, it } from "vitest";
import type { SectionSource } from "../shared/types";
import { SOURCE_META } from "./sources";

// Every source the parser can emit must have presentation metadata, or the
// sidebar/card icon lookup yields undefined and crashes at render.
const ALL_SOURCES: SectionSource[] = [
  "slack",
  "github",
  "notion",
  "linear",
  "datadog",
  "email",
  "calendar",
  "claude-sessions",
  "learnings",
  "partner-tracker",
  "morning-brief",
];

describe("SOURCE_META", () => {
  it.each(ALL_SOURCES)("has a label, icon, and color for %s", (source) => {
    const meta = SOURCE_META[source];
    expect(meta).toBeDefined();
    expect(meta.label).toBeTruthy();
    expect(meta.icon).toBeTruthy();
    expect(meta.color).toMatch(/^var\(--color-/);
  });

  it("has no extra keys beyond the known sources", () => {
    expect(Object.keys(SOURCE_META).sort()).toEqual([...ALL_SOURCES].sort());
  });
});
