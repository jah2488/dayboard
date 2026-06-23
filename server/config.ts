import { homedir } from "node:os";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  ConfigCheck,
  ConfigCheckItem,
  DayboardConfig,
  RoutineConfig,
  RoutinePrompt,
  TabId,
} from "../shared/types.ts";

// The configuration layer. Everything personal- or org-specific is lifted here
// so the shipped repo is generic. Precedence (highest wins):
//   env vars  >  data/config.json  >  built-in DEFAULTS
// Env keeps the original per-knob overrides working (and keeps tests hermetic);
// the file is what the admin panel reads and writes; DEFAULTS make a fresh
// clone boot without any config at all.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();

// Shares the DAYBOARD_DATA_DIR convention with the db/state/brain stores so the
// test harness (which points it at a tmp dir) gets a hermetic config too.
const dataDir = process.env.DAYBOARD_DATA_DIR ?? join(root, "data");
const CONFIG_PATH = process.env.DAYBOARD_CONFIG ?? join(dataDir, "config.json");
const TEMPLATE_DIR = process.env.DAYBOARD_TEMPLATES_DIR ?? join(root, "routines");
const OVERRIDE_DIR = process.env.DAYBOARD_ROUTINES_DIR ?? join(dataDir, "routines");

// Generic, leak-free defaults — a fresh clone runs on these. The user's real
// values live in data/config.json (see dayboard.config.example.json).
export const DEFAULTS: DayboardConfig = {
  identity: { name: "", addressAs: "you" },
  paths: {
    learningsDir: join(home, "Projects", "learnings"),
    claudeProjectsDir: join(home, ".claude", "projects"),
  },
  schedule: { hour: 7, minute: 0 },
  models: { tag: "haiku", reason: "sonnet" },
  github: {
    org: "",
    defaultChannel: "#code-review",
    repoChannels: {},
    repoKeywordRules: {},
  },
  tabs: {
    today: true,
    trends: true,
    prs: true,
    learnings: true,
    sessions: true,
    brain: true,
  },
  routines: [
    { name: "morning-brief", label: "Morning brief", enabled: true },
    { name: "claude-sessions", label: "Claude sessions", enabled: true },
    { name: "partners", label: "Partner tracker", enabled: false },
  ],
  connectors: [
    { id: "slack", label: "Slack", enabled: true },
    { id: "linear", label: "Linear", enabled: true },
    { id: "notion", label: "Notion", enabled: true },
    { id: "datadog", label: "Datadog", enabled: true },
    { id: "gmail", label: "Gmail", enabled: true },
    { id: "calendar", label: "Calendar", enabled: true },
    { id: "granola", label: "Granola", enabled: true },
    { id: "github", label: "GitHub (gh CLI)", enabled: true },
  ],
};

// ---- pure helpers (unit-tested; no IO) ----

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Recursive merge: plain objects merge key-by-key; arrays and primitives
// replace wholesale (so a user's routine/connector list fully wins). Returns a
// new object — never mutates its inputs.
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T));
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in out ? deepMerge((base as Record<string, unknown>)[k], v) : v;
  }
  return out as T;
}

export function expandHome(p: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}

// Substitute {{dotted.path}} against the config. Only known scalar config paths
// are replaced; any other placeholder (a typo, or a downstream token like the
// brain's {{WORK_FILE}}) is left verbatim so it stays visible / composable.
// Richer prompt customization is done by overriding the whole prompt file.
export function renderTemplate(text: string, config: DayboardConfig): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path: string) => {
    const v = path
      .split(".")
      .reduce<unknown>(
        (o, k) => (isPlainObject(o) ? o[k] : undefined),
        config as unknown,
      );
    return v == null || typeof v === "object" ? match : String(v);
  });
}

// Config implied by the legacy per-knob env vars, so they keep overriding the
// file. Only set keys that are actually present.
function envOverrides(): unknown {
  const o: Record<string, unknown> = {};
  const paths: Record<string, string> = {};
  if (process.env.LEARNINGS_DIR) paths.learningsDir = process.env.LEARNINGS_DIR;
  if (process.env.CLAUDE_PROJECTS_DIR)
    paths.claudeProjectsDir = process.env.CLAUDE_PROJECTS_DIR;
  if (Object.keys(paths).length) o.paths = paths;

  const models: Record<string, string> = {};
  if (process.env.SWEEP_TAG_MODEL) models.tag = process.env.SWEEP_TAG_MODEL;
  if (process.env.SWEEP_REASON_MODEL)
    models.reason = process.env.SWEEP_REASON_MODEL;
  if (Object.keys(models).length) o.models = models;

  if (process.env.DAYBOARD_PR_ORG) o.github = { org: process.env.DAYBOARD_PR_ORG };
  return o;
}

// ---- file load (cached by mtime) ----

let cache: { mtimeMs: number; parsed: unknown } | null = null;

function loadFile(): unknown {
  if (!existsSync(CONFIG_PATH)) {
    cache = null;
    return {};
  }
  const mtimeMs = statSync(CONFIG_PATH).mtimeMs;
  if (cache && cache.mtimeMs === mtimeMs) return cache.parsed;
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    parsed = {}; // a malformed file degrades to defaults rather than crashing
  }
  cache = { mtimeMs, parsed };
  return parsed;
}

// The resolved config. Paths are expanded to absolute so consumers don't have
// to. Cheap enough to call per request (file read is mtime-cached).
export function getConfig(): DayboardConfig {
  const merged = deepMerge(
    deepMerge(DEFAULTS, loadFile()),
    envOverrides(),
  ) as DayboardConfig;
  return {
    ...merged,
    paths: {
      learningsDir: expandHome(merged.paths.learningsDir),
      claudeProjectsDir: expandHome(merged.paths.claudeProjectsDir),
    },
  };
}

// Whether a real config file exists (vs running on pure defaults) — surfaced in
// the setup check and used to decide first-run UX.
export function hasConfigFile(): boolean {
  return existsSync(CONFIG_PATH);
}

export function configPath(): string {
  return CONFIG_PATH;
}

// Merge a partial patch into the on-disk config and persist it. Returns the
// freshly resolved config. The whole file is rewritten (single-user local app).
export function saveConfig(patch: unknown): DayboardConfig {
  const current = existsSync(CONFIG_PATH) ? loadFile() : {};
  const next = deepMerge(current as DayboardConfig, patch);
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n");
  cache = null; // force re-read on next getConfig()
  return getConfig();
}

// ---- routine prompt resolution ----
// A routine's prompt is the gitignored override (data/routines/<name>.md) if it
// exists, else the committed template (routines/<name>.md). The sweep runs the
// rendered form; the admin panel edits the override.

function templatePath(name: string): string {
  return join(TEMPLATE_DIR, `${name}.md`);
}
export function overridePath(name: string): string {
  return join(OVERRIDE_DIR, `${name}.md`);
}

export function resolveRoutinePrompt(
  name: string,
  config = getConfig(),
): RoutinePrompt {
  const rc = config.routines.find((r) => r.name === name);
  const ovr = overridePath(name);
  const tpl = templatePath(name);
  const source = existsSync(ovr) ? "override" : existsSync(tpl) ? "template" : "none";
  const raw =
    source === "override"
      ? readFileSync(ovr, "utf8")
      : source === "template"
        ? readFileSync(tpl, "utf8")
        : "";
  return {
    name,
    label: rc?.label ?? name,
    enabled: rc?.enabled ?? false,
    source,
    raw,
    rendered: renderTemplate(raw, config),
  };
}

// Write (or clear) a routine's prompt override. Empty content removes the
// override so the routine falls back to the committed template.
export function writeRoutineOverride(name: string, content: string): RoutinePrompt {
  const ovr = overridePath(name);
  if (content.trim() === "") {
    // Clearing the override reverts the routine to the committed template.
    if (existsSync(ovr)) rmSync(ovr);
  } else {
    mkdirSync(OVERRIDE_DIR, { recursive: true });
    writeFileSync(ovr, content);
  }
  return resolveRoutinePrompt(name);
}

// ---- setup diagnostics (the admin "test my setup" panel) ----

// Is `bin` runnable? A value containing a slash (e.g. the absolute path the
// launchd installer pins SWEEP_CLAUDE_BIN to) is checked directly; a bare name
// is searched on PATH. (Joining an absolute path onto PATH dirs — the old bug —
// always failed, so a perfectly working claude reported "not on PATH".)
function onPath(bin: string): boolean {
  const executable = (p: string) => {
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (bin.includes("/")) return executable(bin);
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  return dirs.some((d) => executable(join(d, bin)));
}

export function checkConfig(config = getConfig()): ConfigCheck {
  const checks: ConfigCheckItem[] = [];
  const add = (item: ConfigCheckItem) => checks.push(item);

  add({
    id: "config-file",
    label: "Config file",
    status: hasConfigFile() ? "ok" : "warn",
    detail: hasConfigFile()
      ? `Loaded ${CONFIG_PATH}`
      : "No data/config.json — running on defaults. Copy dayboard.config.example.json to start.",
  });

  add({
    id: "identity",
    label: "Identity",
    status: config.identity.name ? "ok" : "warn",
    detail: config.identity.name
      ? `Greeting as "${config.identity.name}"`
      : "No name set — the greeting and routines stay generic.",
  });

  for (const [key, dir] of [
    ["learnings", config.paths.learningsDir],
    ["claude-sessions", config.paths.claudeProjectsDir],
  ] as const) {
    add({
      id: `path-${key}`,
      label: key === "learnings" ? "Learnings directory" : "Claude transcripts",
      status: existsSync(dir) ? "ok" : "warn",
      detail: existsSync(dir) ? dir : `Not found: ${dir}`,
    });
  }

  const claudeBin = process.env.SWEEP_CLAUDE_BIN ?? "claude";
  const claudeOk = onPath(claudeBin);
  add({
    id: "claude-bin",
    label: "Claude CLI",
    status: claudeOk ? "ok" : "fail",
    detail: claudeOk
      ? `Found ${claudeBin} (sweeps can run)`
      : `Not runnable: ${claudeBin} — sweeps and summaries will fail.`,
  });

  if (config.tabs.prs) {
    const ghOk = onPath("gh");
    add({
      id: "github",
      label: "GitHub PRs",
      status: config.github.org && ghOk ? "ok" : "warn",
      detail: !config.github.org
        ? "PRs tab is on but github.org is empty — no PRs will load."
        : !ghOk
          ? "gh CLI not on PATH — PR fetch will fail."
          : `Scoped to org "${config.github.org}".`,
    });
  }

  for (const r of config.routines.filter((x) => x.enabled)) {
    const p = resolveRoutinePrompt(r.name, config);
    add({
      id: `routine-${r.name}`,
      label: `Routine: ${r.label}`,
      status: p.source === "none" ? "fail" : "ok",
      detail:
        p.source === "none"
          ? `No prompt found for "${r.name}" (no override, no template).`
          : `Prompt from ${p.source} (${p.rendered.length} chars).`,
    });
  }

  return { ok: !checks.some((c) => c.status === "fail"), checks };
}

// Enabled routines in config order, paired with their resolved prompt — what
// the sweep iterates over.
export function enabledRoutines(config = getConfig()): RoutineConfig[] {
  return config.routines.filter((r) => r.enabled);
}

// Tab visibility for the UI (config-driven nav).
export function enabledTabs(config = getConfig()): TabId[] {
  return (Object.keys(config.tabs) as TabId[]).filter((t) => config.tabs[t]);
}
