import { describe, expect, it } from "vitest";
import { parseTags, slugify } from "./session-tags.ts";

describe("slugify", () => {
  it("kebab-cases and trims punctuation", () => {
    expect(slugify("Build Minutes!")).toBe("build-minutes");
    expect(slugify("  project-beta  ")).toBe("project-beta");
  });
});

describe("parseTags", () => {
  it("parses {slug,label} objects, dedupes, caps at 5", () => {
    const out = `Sure:
    [{"slug":"project-alpha","label":"Project Alpha"},{"slug":"project-alpha","label":"Project Alpha"},
     {"slug":"ct","label":"Project Beta"},{"slug":"a","label":"A"},
     {"slug":"b","label":"B"},{"slug":"c","label":"C"},{"slug":"d","label":"D"}]`;
    const tags = parseTags(out);
    expect(tags.map((t) => t.slug)).toEqual(["project-alpha", "ct", "a", "b", "c"]); // dup dropped, capped at 5
  });

  it("accepts bare string tags and slugifies the label", () => {
    expect(parseTags(`["Build Minutes", "MongoDB"]`)).toEqual([
      { slug: "build-minutes", label: "Build Minutes" },
      { slug: "mongodb", label: "MongoDB" },
    ]);
  });

  it("returns [] when there's no array or it's unparseable", () => {
    expect(parseTags("no tags here")).toEqual([]);
    expect(parseTags("[not json]")).toEqual([]);
    expect(parseTags("[]")).toEqual([]);
  });
});
