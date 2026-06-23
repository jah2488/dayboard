import { describe, expect, it } from "vitest";
import { extractIssues, parseBriefToSections } from "./routines.ts";
import { DEFAULTS, resolveRoutinePrompt } from "./config.ts";

describe("default routine registry (config)", () => {
  it("ships at least one routine, each with a name and human label", () => {
    expect(DEFAULTS.routines.length).toBeGreaterThan(0);
    for (const r of DEFAULTS.routines) {
      expect(r.name).toBeTruthy();
      expect(r.label).toBeTruthy();
    }
  });

  it("every enabled default routine resolves to a committed prompt template", () => {
    for (const r of DEFAULTS.routines.filter((x) => x.enabled)) {
      expect(resolveRoutinePrompt(r.name).source, `${r.name} prompt missing`).not.toBe(
        "none",
      );
    }
  });
});

describe("parseBriefToSections", () => {
  it("splits a brief into one section per ## heading", () => {
    const md = [
      "# Morning brief — today",
      "",
      "## Slack — needs a reply",
      "- ping from Alex",
      "",
      "## Linear — assigned to you",
      "- ENG-1 do the thing",
    ].join("\n");
    const out = parseBriefToSections(md);
    expect(out.map((s) => s.title)).toEqual([
      "Slack — needs a reply",
      "Linear — assigned to you",
    ]);
    expect(out[0].bodyMd).toBe("- ping from Alex");
  });

  it("drops the leading # title and any content before the first ##", () => {
    const md = "# Title\n\nstray preamble\n\n## Slack\n- a";
    const out = parseBriefToSections(md);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Slack");
    expect(out[0].bodyMd).toBe("- a");
  });

  it("trims a trailing --- footer off the last section", () => {
    const md = "## GitHub\n- pr 1\n\n---\n*footer note*\n";
    const out = parseBriefToSections(md);
    expect(out[0].bodyMd).toBe("- pr 1");
  });

  it("normalizes CRLF line endings", () => {
    const md = "## Slack\r\n- a\r\n- b\r\n";
    const out = parseBriefToSections(md);
    expect(out[0].bodyMd).toBe("- a\n- b");
  });

  it("returns nothing when there are no ## headings", () => {
    expect(parseBriefToSections("just text, no headings")).toEqual([]);
    expect(parseBriefToSections("")).toEqual([]);
  });

  // source detection — one case per branch of sourceFromHeading
  it.each([
    ["## Slack — needs a reply", "slack"],
    ["## Linear — assigned to you", "linear"],
    ["## Notion — you were mentioned", "notion"],
    ["## Datadog — active incidents", "datadog"],
    ["## Partners — needs triage", "partner-tracker"],
    ["## GitHub", "github"],
    ["## pull request roundup", "github"],
    ["## Calendar — today's schedule", "calendar"],
    ["## Email — needs a reply", "email"],
    ["## mail digest", "email"],
    ["## Claude sessions — open threads", "claude-sessions"],
    ["## Learnings — new since last sweep", "learnings"],
    ["## Something unrecognized", "morning-brief"],
  ])("maps heading %s to source %s", (heading, source) => {
    expect(parseBriefToSections(`${heading}\n- x`)[0].source).toBe(source);
  });
});

describe("extractIssues", () => {
  it("parses 'Source — reason' issue lines", () => {
    const md = "## Calendar\nISSUE: Google Calendar — connector missing\n";
    expect(extractIssues(md)).toEqual([
      { source: "Google Calendar", message: "connector missing" },
    ]);
  });

  it("accepts a hyphen separator and strips bold markers", () => {
    const md = "ISSUE: **GitHub** - gh not authenticated";
    expect(extractIssues(md)).toEqual([
      { source: "GitHub", message: "gh not authenticated" },
    ]);
  });

  it("tolerates a leading blockquote marker and odd casing", () => {
    expect(extractIssues("> issue: Slack — lost connection")).toEqual([
      { source: "Slack", message: "lost connection" },
    ]);
  });

  it("falls back to source 'sweep' when there is no separator", () => {
    expect(extractIssues("ISSUE: everything is on fire")).toEqual([
      { source: "sweep", message: "everything is on fire" },
    ]);
  });

  it("ignores non-issue lines", () => {
    expect(extractIssues("## Slack\n- a normal bullet\n")).toEqual([]);
  });
});
