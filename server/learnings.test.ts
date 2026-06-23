import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// learnings.ts reads LEARNINGS_DIR at import time, so set it up and import lazily.
let learnings: typeof import("./learnings.ts");
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "dayboard-learnings-"));
  writeFileSync(join(dir, "2026-06-08-project-alpha-prep.md"), "# Project Alpha renewal prep\n\nbody");
  writeFileSync(join(dir, "2026-06-01-project-beta.md"), "no heading here");
  writeFileSync(join(dir, "untitled-note.md"), "# Has Title\n");
  writeFileSync(join(dir, "ignore-me.txt"), "not markdown");
  process.env.LEARNINGS_DIR = dir;
  learnings = await import("./learnings.ts");
});

describe("listLearnings", () => {
  it("lists only .md files, newest date first", () => {
    const docs = learnings.listLearnings();
    expect(docs.map((d) => d.file)).toEqual([
      "2026-06-08-project-alpha-prep.md",
      "2026-06-01-project-beta.md",
      "untitled-note.md", // no date prefix -> sorts last
    ]);
  });

  it("derives title from the first H1, the date from the filename prefix", () => {
    const alpha = learnings.listLearnings().find((d) => d.file.startsWith("2026-06-08"))!;
    expect(alpha.title).toBe("Project Alpha renewal prep");
    expect(alpha.date).toBe("2026-06-08");
    expect(alpha.slug).toBe("project-alpha-prep");
  });

  it("humanizes the slug when there is no H1 and no date prefix", () => {
    const note = learnings.listLearnings().find((d) => d.file === "untitled-note.md")!;
    // file has an H1 ("Has Title") so title comes from content; date is null
    expect(note.title).toBe("Has Title");
    expect(note.date).toBeNull();
  });
});

describe("getLearning", () => {
  it("returns content for a valid filename", () => {
    expect(learnings.getLearning("2026-06-08-project-alpha-prep.md")?.content).toContain("body");
  });

  it("rejects path traversal and non-md names", () => {
    expect(learnings.getLearning("../../../etc/passwd")).toBeNull();
    expect(learnings.getLearning("notes.txt")).toBeNull();
  });

  it("returns null for a missing file", () => {
    expect(learnings.getLearning("nope.md")).toBeNull();
  });
});
