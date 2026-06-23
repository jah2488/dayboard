import { getBrainGraph } from "./brain.ts";
import { writeWorkFile } from "./brain-store.ts";
import { runClaude as runClaudeBin } from "./claude.ts";
import { getConfig, resolveRoutinePrompt } from "./config.ts";

// "Surface overlap": a focused, on-demand synthesis of just the selected topics
// — their member docs and the links between them — to find what connects them
// (or report that little does). Distinct from the daily discoveries sweep, which
// reasons over the whole graph; this is scoped to a 2+ topic comparison the user
// asked for, and returns a short markdown summary rather than stored discoveries.

const OVERLAP_TIMEOUT_MS = Number(process.env.SWEEP_OVERLAP_TIMEOUT_MS ?? 600_000);

export interface OverlapResult {
  topics: Array<{ slug: string; label: string }>;
  markdown: string;
}

// Pure: build the work payload (selected topics, their member docs, the links
// among those docs) from the graph. Exported for unit testing.
export function buildOverlapPayload(
  graph: ReturnType<typeof getBrainGraph>,
  slugs: string[],
) {
  const selected = new Set(slugs);
  const topics = graph.topics
    .filter((t) => selected.has(t.slug))
    .map((t) => ({ slug: t.slug, label: t.label }));

  const docs = graph.docs
    .filter((d) => !d.missing && d.topics.some((t) => selected.has(t.slug)))
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      date: d.date,
      summary: d.summary,
      // which of the SELECTED topics this doc belongs to (>1 = a bridge)
      belongsTo: d.topics.map((t) => t.slug).filter((s) => selected.has(s)),
    }));

  const docIds = new Set(docs.map((d) => d.id));
  const links = graph.links
    .filter((l) => docIds.has(l.from) && docIds.has(l.to))
    .map((l) => ({ from: l.from, to: l.to, reason: l.reason }));

  return { topics, docs, links };
}

const mockMarkdown = (payload: ReturnType<typeof buildOverlapPayload>): string => {
  const bridges = payload.docs.filter((d) => d.belongsTo.length > 1);
  return [
    `**Verdict:** ${bridges.length ? "entangled" : "largely independent"} — mock overlap of ${payload.topics
      .map((t) => t.label)
      .join(" ∩ ")}.`,
    ``,
    `**Bridges:** ${bridges.length ? bridges.map((d) => d.title).join("; ") : "None — no document spans these topics."}`,
  ].join("\n");
};

// Run the overlap synthesis. Throws on bad input (caller maps to 4xx) or a
// claude failure (caller maps to 502).
export async function surfaceOverlap(slugs: string[]): Promise<OverlapResult> {
  const unique = [...new Set(slugs.filter((s) => typeof s === "string" && s))];
  if (unique.length < 2) throw new Error("pick at least two topics");

  const graph = getBrainGraph();
  const payload = buildOverlapPayload(graph, unique);
  if (payload.topics.length < 2) throw new Error("two or more known topics required");

  if (process.env.SWEEP_MOCK === "1") {
    return { topics: payload.topics, markdown: mockMarkdown(payload) };
  }

  const workFile = writeWorkFile("overlap", payload);
  const prompt = resolveRoutinePrompt("brain-overlap").rendered.replace("{{WORK_FILE}}", workFile);
  const markdown = await runClaudeBin(
    prompt,
    undefined,
    OVERLAP_TIMEOUT_MS,
    getConfig().models.reason,
  );
  return { topics: payload.topics, markdown: markdown.trim() };
}
