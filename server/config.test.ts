import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DayboardConfig } from "../shared/types.ts";

// config resolves its paths at import time — stage tmp dirs first, import lazily.
let cfg: typeof import("./config.ts");
let dir: string;
let configFile: string;
let templatesDir: string;
let overridesDir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "dayboard-config-"));
  configFile = join(dir, "config.json");
  templatesDir = join(dir, "templates");
  overridesDir = join(dir, "overrides");
  mkdirSync(templatesDir, { recursive: true });
  mkdirSync(overridesDir, { recursive: true });
  process.env.DAYBOARD_CONFIG = configFile;
  process.env.DAYBOARD_TEMPLATES_DIR = templatesDir;
  process.env.DAYBOARD_ROUTINES_DIR = overridesDir;
  cfg = await import("./config.ts");
});

// Tests mutate the config file + env; reset both between cases.
afterEach(() => {
  writeFileSync(configFile, "{}");
  delete process.env.LEARNINGS_DIR;
  delete process.env.SWEEP_REASON_MODEL;
  delete process.env.DAYBOARD_PR_ORG;
});

describe("deepMerge", () => {
  it("merges nested plain objects key-by-key", () => {
    expect(cfg.deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 9 } })).toEqual({
      a: { x: 1, y: 9 },
    });
  });
  it("replaces arrays wholesale rather than concatenating", () => {
    expect(cfg.deepMerge({ a: [1, 2, 3] }, { a: [9] })).toEqual({ a: [9] });
  });
  it("does not mutate its inputs", () => {
    const base = { a: { x: 1 } };
    cfg.deepMerge(base, { a: { x: 2 } });
    expect(base).toEqual({ a: { x: 1 } });
  });
});

describe("expandHome", () => {
  it("expands a leading ~/", () => {
    expect(cfg.expandHome("~/Projects/x")).toBe(join(homedir(), "Projects/x"));
  });
  it("leaves absolute paths untouched (idempotent)", () => {
    expect(cfg.expandHome("/abs/path")).toBe("/abs/path");
  });
});

describe("renderTemplate", () => {
  const config = { identity: { name: "Sam" }, paths: { learningsDir: "/l" } } as DayboardConfig;
  it("substitutes dotted scalar paths", () => {
    expect(cfg.renderTemplate("Hi {{identity.name}} at {{paths.learningsDir}}", config)).toBe(
      "Hi Sam at /l",
    );
  });
  it("leaves unknown placeholders and non-scalar paths verbatim", () => {
    expect(cfg.renderTemplate("[{{nope.gone}}][{{identity}}][{{WORK_FILE}}]", config)).toBe(
      "[{{nope.gone}}][{{identity}}][{{WORK_FILE}}]",
    );
  });
});

describe("getConfig — precedence and expansion", () => {
  it("falls back to generic defaults with no file", () => {
    const c = cfg.getConfig();
    expect(c.identity.name).toBe("");
    expect(c.github.org).toBe("");
    expect(c.tabs.today).toBe(true);
  });

  it("file overrides defaults; partial tabs keep their default", () => {
    writeFileSync(configFile, JSON.stringify({ identity: { name: "Sam" }, tabs: { prs: false } }));
    const c = cfg.getConfig();
    expect(c.identity.name).toBe("Sam");
    expect(c.tabs.prs).toBe(false);
    expect(c.tabs.today).toBe(true); // untouched default
  });

  it("env overrides the file (back-compat with the legacy knobs)", () => {
    writeFileSync(configFile, JSON.stringify({ github: { org: "fromfile" } }));
    process.env.DAYBOARD_PR_ORG = "fromenv";
    process.env.LEARNINGS_DIR = "/env/learnings";
    const c = cfg.getConfig();
    expect(c.github.org).toBe("fromenv");
    expect(c.paths.learningsDir).toBe("/env/learnings");
  });

  it("expands ~ in configured paths", () => {
    writeFileSync(configFile, JSON.stringify({ paths: { learningsDir: "~/foo" } }));
    expect(cfg.getConfig().paths.learningsDir).toBe(join(homedir(), "foo"));
  });
});

describe("saveConfig", () => {
  it("merges a patch into the file and re-resolves", () => {
    cfg.saveConfig({ identity: { name: "Ada" } });
    cfg.saveConfig({ schedule: { hour: 9 } });
    const c = cfg.getConfig();
    expect(c.identity.name).toBe("Ada"); // first patch survived the second
    expect(c.schedule.hour).toBe(9);
    expect(c.schedule.minute).toBe(0); // default preserved
  });
});

describe("resolveRoutinePrompt", () => {
  it("uses the committed template when no override exists, and renders it", () => {
    writeFileSync(join(templatesDir, "morning-brief.md"), "Brief for {{identity.name}}.");
    writeFileSync(configFile, JSON.stringify({ identity: { name: "Sam" } }));
    const p = cfg.resolveRoutinePrompt("morning-brief");
    expect(p.source).toBe("template");
    expect(p.rendered).toBe("Brief for Sam.");
  });

  it("prefers the override over the template", () => {
    writeFileSync(join(templatesDir, "morning-brief.md"), "template");
    writeFileSync(join(overridesDir, "morning-brief.md"), "my own {{identity.name}}");
    writeFileSync(configFile, JSON.stringify({ identity: { name: "Sam" } }));
    const p = cfg.resolveRoutinePrompt("morning-brief");
    expect(p.source).toBe("override");
    expect(p.rendered).toBe("my own Sam");
  });

  it("reports source 'none' when neither exists", () => {
    expect(cfg.resolveRoutinePrompt("ghost").source).toBe("none");
  });
});

describe("writeRoutineOverride", () => {
  it("writes an override, then clears it to fall back to the template", () => {
    writeFileSync(join(templatesDir, "claude-sessions.md"), "TPL");
    cfg.writeRoutineOverride("claude-sessions", "MINE");
    expect(readFileSync(join(overridesDir, "claude-sessions.md"), "utf8")).toBe("MINE");
    const reverted = cfg.writeRoutineOverride("claude-sessions", "  ");
    expect(reverted.source).toBe("template");
    expect(reverted.raw).toBe("TPL");
  });
});

describe("checkConfig", () => {
  it("flags a missing claude binary as a hard failure", () => {
    const savedPath = process.env.PATH;
    process.env.PATH = "/nonexistent-bin-dir";
    const r = cfg.checkConfig();
    process.env.PATH = savedPath;
    const claudeCheck = r.checks.find((c) => c.id === "claude-bin");
    expect(claudeCheck?.status).toBe("fail");
    expect(r.ok).toBe(false);
  });

  it("accepts an ABSOLUTE SWEEP_CLAUDE_BIN (the launchd installer pins one)", () => {
    // process.execPath is an absolute, executable path that definitely exists —
    // stands in for the resolved claude binary. The old onPath joined it onto
    // PATH dirs and wrongly reported "not on PATH".
    const saved = process.env.SWEEP_CLAUDE_BIN;
    process.env.SWEEP_CLAUDE_BIN = process.execPath;
    const claudeCheck = cfg.checkConfig().checks.find((c) => c.id === "claude-bin");
    process.env.SWEEP_CLAUDE_BIN = saved;
    expect(claudeCheck?.status).toBe("ok");
  });

  it("fails an absolute SWEEP_CLAUDE_BIN that doesn't exist", () => {
    const saved = process.env.SWEEP_CLAUDE_BIN;
    process.env.SWEEP_CLAUDE_BIN = "/nope/definitely/not/claude";
    const claudeCheck = cfg.checkConfig().checks.find((c) => c.id === "claude-bin");
    process.env.SWEEP_CLAUDE_BIN = saved;
    expect(claudeCheck?.status).toBe("fail");
  });
});
