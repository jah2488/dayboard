import { join, resolve } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { getConfig } from "./config.ts";
import type { LearningContent, LearningDoc } from "../shared/types.ts";

// Reference docs (the Learnings tab + brain source). Location is config-driven
// (paths.learningsDir), resolved per call so a config edit takes effect live.
const learningsDir = () => getConfig().paths.learningsDir;

const FILENAME = /^([A-Za-z0-9._-]+)\.md$/;
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

function titleFromContent(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1] : fallback;
}

function humanizeSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseMeta(file: string, content: string): Omit<LearningDoc, "mtime"> {
  const base = file.replace(/\.md$/, "");
  const dm = base.match(DATE_PREFIX);
  const date = dm ? dm[1] : null;
  const slug = dm ? dm[2] : base;
  return {
    file,
    date,
    slug,
    title: titleFromContent(content, humanizeSlug(slug)),
  };
}

export function listLearnings(): LearningDoc[] {
  const root = learningsDir();
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const full = join(root, file);
      const content = readFileSync(full, "utf8");
      return { ...parseMeta(file, content), mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.mtime - a.mtime);
}

// Path-safe single-doc read: filename only, must resolve inside the dir.
export function getLearning(file: string): LearningContent | null {
  if (!FILENAME.test(file)) return null;
  const root = learningsDir();
  const full = resolve(root, file);
  if (!full.startsWith(resolve(root))) return null;
  if (!existsSync(full)) return null;
  const content = readFileSync(full, "utf8");
  return { ...parseMeta(file, content), content };
}
