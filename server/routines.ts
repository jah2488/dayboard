import type { SectionSource } from "../shared/types.ts";

// The list of sweep routines (name, label, enabled, order) lives in config
// (config.routines); their prompts resolve through config.ts
// (resolveRoutinePrompt: local override -> committed template, then rendered).
// This module is just the pure brief parser the sweep feeds those results into.

// Infer a source (for color/icon) from an H2 heading.
function sourceFromHeading(heading: string): SectionSource {
  const h = heading.toLowerCase();
  if (h.includes("slack")) return "slack";
  if (h.includes("linear")) return "linear";
  if (h.includes("notion")) return "notion";
  if (h.includes("datadog")) return "datadog";
  if (h.includes("partner")) return "partner-tracker";
  if (h.includes("github") || h.includes("pull request")) return "github";
  if (h.includes("calendar")) return "calendar";
  if (h.includes("email") || h.includes("mail")) return "email";
  if (h.includes("session")) return "claude-sessions";
  if (h.includes("learning")) return "learnings";
  return "morning-brief";
}

// Routines emit `ISSUE: <Source> — <reason>` lines when a connector/fetch
// fails. Pull them out for the dashboard's alert panel.
export function extractIssues(md: string): Array<{ source: string; message: string }> {
  const out: Array<{ source: string; message: string }> = [];
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^\s*>?\s*ISSUE:\s*(.+?)\s*$/i);
    if (!m) continue;
    const text = m[1].replace(/\*\*/g, "").trim();
    const split = text.match(/^(.+?)\s*[—-]\s*(.+)$/); // "Source — reason"
    if (split) out.push({ source: split[1].trim(), message: split[2].trim() });
    else out.push({ source: "sweep", message: text });
  }
  return out;
}

export interface ParsedSection {
  source: SectionSource;
  title: string;
  bodyMd: string;
}

// Split a brief into sections by top-level `## ` headings. Content before the
// first `##` (the `# Title`) is dropped; a trailing `---` footer is trimmed.
export function parseBriefToSections(md: string): ParsedSection[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: ParsedSection[] = [];
  let cur: ParsedSection | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (cur) out.push(cur);
      cur = { source: sourceFromHeading(m[1]), title: m[1], bodyMd: "" };
    } else if (cur) {
      cur.bodyMd += line + "\n";
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({
    ...s,
    bodyMd: s.bodyMd.replace(/\n*---\n[\s\S]*$/, "").trim(),
  }));
}
