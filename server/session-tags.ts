// Lightweight auto-tagging for interactive sessions. The brain sweep already
// tags sessions it indexes; this is a cheap, targeted catch-up that tags ONLY
// untagged interactive sessions (not the thousands of agent/subagent runs),
// one Haiku call each, writing into the same brain topic store the Sessions
// tab reads. Functional core (slugify/parseTags) is pure; the runClaude +
// store writes are the shell.

import { isUsageLimitError, runClaude } from "./claude.ts";
import {
  readAllConnections,
  readConnections,
  readTopics,
  writeConnections,
  writeTopics,
} from "./brain-store.ts";
import { getConfig } from "./config.ts";
import { getSession, listSessions } from "./sessions.ts";
import type { BrainConnections, BrainTopic } from "../shared/types.ts";

const tagModel = () => getConfig().models.tag;
const MAX_TAGS = 5;

// Kebab-case, mirroring the brain's topic-id discipline.
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface TagResult {
  slug: string;
  label: string;
}

// Pure: pull {slug,label} (or bare-string) tags out of Claude's JSON reply,
// slugified + deduped, capped. Tolerates prose around the array.
export function parseTags(out: string): TagResult[] {
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const seen = new Set<string>();
  const tags: TagResult[] = [];
  for (const item of arr) {
    const rec = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const label =
      typeof item === "string" ? item : rec && typeof rec.label === "string" ? rec.label : null;
    if (!label || !label.trim()) continue;
    const slug = slugify(rec && typeof rec.slug === "string" ? rec.slug : label);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    tags.push({ slug, label: label.trim() });
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

const tagPrompt = (goal: string, outcome: string, tools: string, registry: string) => `\
You are tagging a finished Claude Code session for a developer's knowledge dashboard.
Choose 1-5 short topic tags capturing what this session was actually about.
STRONGLY prefer reusing an existing topic from this registry (match by meaning, reuse its slug verbatim):
${registry || "(registry empty)"}
Only coin a new tag if no existing topic fits a clearly central, recurring theme. Never tag one-off details (file names, dates, error strings).
Reply with ONLY a JSON array of {"slug","label"} objects. Example: [{"slug":"project-alpha","label":"Project Alpha"}]

GOAL:
${goal.slice(0, 1500)}

OUTCOME:
${outcome.slice(0, 1500)}

TOOLS: ${tools}`;

// Topics the model coined that aren't in the registry yet — add them so their
// label resolves (instead of falling back to the raw slug).
function registerNewTopics(tags: TagResult[]): void {
  const topics = readTopics();
  const known = new Set(topics.map((t) => t.slug));
  const additions: BrainTopic[] = tags
    .filter((t) => !known.has(t.slug))
    .map((t) => ({ slug: t.slug, label: t.label, description: "", summary: "", summaryFingerprint: "" }));
  if (additions.length) writeTopics([...topics, ...additions]);
}

async function tagOne(id: string): Promise<TagResult[]> {
  const detail = getSession(id);
  if (!detail) return [];

  const tags = await (async () => {
    if (process.env.SWEEP_MOCK === "1") return [{ slug: "mock-topic", label: "Mock topic" }];
    const registry = readTopics()
      .map((t) => `- ${t.slug}: ${t.label}`)
      .join("\n");
    const tools =
      detail.stats.toolCalls.byName
        .slice(0, 8)
        .map((t) => `${t.name}×${t.count}`)
        .join(", ") || "none";
    const out = await runClaude(
      tagPrompt(
        detail.summary?.goal ?? detail.goal,
        detail.summary?.outcome ?? detail.results,
        tools,
        registry,
      ),
      undefined,
      undefined,
      tagModel(),
    );
    return parseTags(out);
  })();

  if (!tags.length) return [];
  registerNewTopics(tags);

  // Reuse any existing connection (preserve its links) and just set topics.
  const existing = readConnections(`session:${id}`);
  const base: BrainConnections =
    existing ??
    ({
      id: `session:${id}`,
      kind: "session",
      title: detail.title,
      date: detail.startedAt?.slice(0, 10) ?? null,
      summary: detail.summary?.outcome ?? "",
      origin: detail.origin,
      topics: [],
      linksTo: [],
      linkedFrom: [],
      sourceMtime: detail.mtime,
      indexedAt: "",
    } satisfies BrainConnections);
  writeConnections({
    ...base,
    topics: tags.map((t) => ({ slug: t.slug, strength: 0.6, excerpt: null })),
    // sourceMtime 0 (not the real mtime) keeps these "stale" to the brain sweep
    // (brain-sweep.ts uses strict `<`), so the next sweep RE-INDEXES them with
    // proper AI links + summary. These quick tags are an interim bootstrap, not
    // a permanent stand-in that shadows real indexing.
    sourceMtime: 0,
    indexedAt: new Date().toISOString(),
  });
  return tags;
}

export function untaggedInteractiveSessionIds(): string[] {
  // One directory read, not one stat per session.
  const tagged = new Set(
    readAllConnections()
      .filter((c) => c.kind === "session" && c.topics.length > 0)
      .map((c) => c.id.replace(/^session:/, "")),
  );
  return listSessions()
    .filter((s) => s.category === "interactive" && !tagged.has(s.id))
    .map((s) => s.id);
}

export interface BackfillResult {
  tagged: number;
  deferred: boolean; // hit the usage limit and stopped early
  errors: number;
  remaining: number; // still-untagged interactive sessions after this run
}

// Tag untagged interactive sessions sequentially (machine-kind). Defers (stops)
// on a usage-limit hit rather than recording bogus failures.
export async function backfillSessionTags(limit = 200): Promise<BackfillResult> {
  const batch = untaggedInteractiveSessionIds().slice(0, limit);
  let tagged = 0;
  let errors = 0;
  let deferred = false;
  for (const id of batch) {
    try {
      if ((await tagOne(id)).length) tagged++;
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (isUsageLimitError(msg)) {
        deferred = true;
        break;
      }
      errors++;
    }
  }
  return { tagged, deferred, errors, remaining: untaggedInteractiveSessionIds().length };
}
