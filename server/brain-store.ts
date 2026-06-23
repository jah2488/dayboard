import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PENDING_VERIFICATION } from "./brain-discover.ts";
import type {
  BrainConnections,
  BrainDiscovery,
  BrainHidden,
  BrainTopic,
} from "../shared/types.ts";

// Brain storage — the files ARE the source of truth (no DB tables): one
// connections JSON per indexed doc plus a topic registry. DAYBOARD_BRAIN_DIR
// lets tests (and relocations) point at an isolated directory.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAIN_DIR =
  process.env.DAYBOARD_BRAIN_DIR ??
  join(process.env.DAYBOARD_DATA_DIR ?? join(root, "data"), "brain");
const CONNECTIONS_DIR = join(BRAIN_DIR, "connections");
const WORK_DIR = join(BRAIN_DIR, "work");
const TOPICS_FILE = join(BRAIN_DIR, "topics.json");
const DISCOVERIES_FILE = join(BRAIN_DIR, "discoveries.json");
const HIDDEN_FILE = join(BRAIN_DIR, "hidden.json");

// Connections files written before the origin field lack it. Learnings are
// always "direct"; legacy sessions default to "agent" — most legacy session
// churn here was agent runs, so it's the safer guess (and a real interactive
// session re-indexes back to "direct" the next time its transcript changes).
function normalizeConnections(c: BrainConnections): BrainConnections {
  if (c.origin) return c;
  return { ...c, origin: c.kind === "learning" ? "direct" : "agent" };
}

// "learning:<file.md>" -> connections/learning--<file>.json,
// "session:<uuid>"    -> connections/session--<uuid>.json.
// The strict shape doubles as path safety for ids arriving over HTTP.
const DOC_ID = /^(learning|session):([A-Za-z0-9._-]+)$/;

export function connectionsPath(id: string): string | null {
  const m = id.match(DOC_ID);
  return m ? join(CONNECTIONS_DIR, `${m[1]}--${m[2].replace(/\.md$/, "")}.json`) : null;
}

export function readConnections(id: string): BrainConnections | null {
  const path = connectionsPath(id);
  if (!path || !existsSync(path)) return null;
  try {
    return normalizeConnections(JSON.parse(readFileSync(path, "utf8")) as BrainConnections);
  } catch {
    return null;
  }
}

export function readAllConnections(): BrainConnections[] {
  if (!existsSync(CONNECTIONS_DIR)) return [];
  return readdirSync(CONNECTIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        return [
          normalizeConnections(
            JSON.parse(readFileSync(join(CONNECTIONS_DIR, f), "utf8")) as BrainConnections,
          ),
        ];
      } catch {
        return []; // one corrupt file must not take down the whole graph
      }
    });
}

export function writeConnections(conn: BrainConnections): void {
  const path = connectionsPath(conn.id);
  if (!path) throw new Error(`Unwritable brain doc id: ${conn.id}`);
  mkdirSync(CONNECTIONS_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(conn, null, 2));
}

export function deleteConnections(id: string): void {
  const path = connectionsPath(id);
  if (path) rmSync(path, { force: true });
}

export function readTopics(): BrainTopic[] {
  if (!existsSync(TOPICS_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(TOPICS_FILE, "utf8")) as { topics?: BrainTopic[] };
    return parsed.topics ?? [];
  } catch {
    return [];
  }
}

export function writeTopics(topics: BrainTopic[]): void {
  mkdirSync(BRAIN_DIR, { recursive: true });
  writeFileSync(TOPICS_FILE, JSON.stringify({ topics }, null, 2));
}

// ALL discovery records, active and dismissed — dismissals are permanent
// tombstones the sweep must see to avoid resurrecting them.
export function readDiscoveries(): BrainDiscovery[] {
  if (!existsSync(DISCOVERIES_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(DISCOVERIES_FILE, "utf8")) as {
      discoveries?: BrainDiscovery[];
    };
    // Files written before the verification/hidden fields lack them — a missing
    // verification is just an unresearched hypothesis; a missing hidden is shown.
    return (parsed.discoveries ?? []).map((d) => ({
      ...d,
      verification: d.verification ?? PENDING_VERIFICATION,
      hidden: d.hidden ?? false,
    }));
  } catch {
    return [];
  }
}

export function writeDiscoveries(discoveries: BrainDiscovery[]): void {
  mkdirSync(BRAIN_DIR, { recursive: true });
  writeFileSync(DISCOVERIES_FILE, JSON.stringify({ discoveries }, null, 2));
}

// Hidden doc ids + topic slugs — kept out of the default graph view but never
// deleted (a "Show hidden" toggle ghosts them back). Tolerant of a missing or
// corrupt file: an empty hidden set is the safe default.
export function readHidden(): BrainHidden {
  if (!existsSync(HIDDEN_FILE)) return { docs: [], topics: [] };
  try {
    const parsed = JSON.parse(readFileSync(HIDDEN_FILE, "utf8")) as Partial<BrainHidden>;
    return {
      docs: Array.isArray(parsed.docs) ? parsed.docs : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
    };
  } catch {
    return { docs: [], topics: [] };
  }
}

export function writeHidden(hidden: BrainHidden): void {
  mkdirSync(BRAIN_DIR, { recursive: true });
  writeFileSync(HIDDEN_FILE, JSON.stringify(hidden, null, 2));
}

// Transient hand-off to `claude -p`; overwritten freely on every sweep.
export function writeWorkFile(name: string, payload: unknown): string {
  mkdirSync(WORK_DIR, { recursive: true });
  const path = join(WORK_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
}
