import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type {
  BrainDiscovery,
  BrainDocKind,
  BrainGraph,
  SessionOrigin,
} from "../../shared/types";

export type BrainSelection = { type: "topic" | "doc"; id: string };

// Topic node keys are namespaced "topic:<slug>"; doc ids already carry a
// "learning:"/"session:" prefix, so the two key spaces can't collide.
export const nodeKey = (sel: BrainSelection): string =>
  sel.type === "topic" ? `topic:${sel.id}` : sel.id;

// A focused discovery lights up its evidence: doc ids are node keys already,
// but topic slugs need the "topic:" namespace before the graph can find them.
export const discoveryHighlightKeys = (
  d: Pick<BrainDiscovery, "docs" | "topics">,
): Set<string> =>
  new Set([...d.docs, ...d.topics.map((slug) => nodeKey({ type: "topic", id: slug }))]);

export interface LayoutNode {
  key: string;
  sel: BrainSelection;
  label: string;
  short: string; // map-friendly truncation — full label stays in aria/tooltips
  kind: BrainDocKind | "topic";
  origin: SessionOrigin | null; // session origin for agent-vs-direct styling; null for topics
  hidden: boolean; // ghosted (kept in the layout) only while Show hidden is on
  docCount: number;
  r: number;
  x: number;
  y: number;
}

const MAX_LABEL = 32;
const short = (s: string) => (s.length > MAX_LABEL ? s.slice(0, MAX_LABEL - 1) + "…" : s);

export interface LayoutEdge {
  source: string;
  target: string;
  membership: boolean; // doc→topic (faint) vs doc→doc (warm, has a reason)
  reason: string;
}

export interface BrainLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  viewBox: { x: number; y: number; width: number; height: number };
}

type SimNode = SimulationNodeDatum & { key: string; r: number };
type SimLink = SimulationLinkDatum<SimNode> & { membership: boolean };

// Run the force simulation synchronously to a settled layout — no animation
// loop, deliberately: calm, reduced-motion-friendly, and deterministic in
// tests (d3-force ≥2 uses a seeded LCG, so output is reproducible).
const TICKS = 300;

// `showHidden` keeps hidden docs/topics in the layout, tagged so the graph can
// ghost them; the default view drops them (and their incident edges) entirely.
// `charge` is the many-body force strength (more negative = stronger repulsion
// = nodes spread further); the gravity slider drives it.
export const DEFAULT_CHARGE = -160;
export function layoutBrainGraph(
  graph: BrainGraph,
  showHidden = false,
  charge = DEFAULT_CHARGE,
): BrainLayout {
  const hiddenDocs = new Set(graph.hidden.docs);
  const hiddenTopics = new Set(graph.hidden.topics);
  const keep = (hidden: boolean) => showHidden || !hidden;

  const topics = graph.topics.filter((t) => keep(hiddenTopics.has(t.slug)));
  const docs = graph.docs.filter((d) => !d.missing && keep(hiddenDocs.has(d.id)));
  const docIds = new Set(docs.map((d) => d.id));
  const slugs = new Set(topics.map((t) => t.slug));

  const bare = [
    ...topics.map((t) => ({
      key: nodeKey({ type: "topic" as const, id: t.slug }),
      sel: { type: "topic" as const, id: t.slug },
      label: t.label,
      short: short(t.label),
      kind: "topic" as const,
      origin: null,
      hidden: hiddenTopics.has(t.slug),
      docCount: t.docCount,
      r: Math.min(26, 10 + t.docCount * 2),
    })),
    ...docs.map((d) => ({
      key: d.id,
      sel: { type: "doc" as const, id: d.id },
      label: d.title,
      short: short(d.title),
      kind: d.kind,
      origin: d.kind === "session" ? d.origin : null,
      hidden: hiddenDocs.has(d.id),
      docCount: 0,
      r: 7,
    })),
  ];

  const edges: LayoutEdge[] = [
    ...docs.flatMap((d) =>
      d.topics
        .filter((t) => slugs.has(t.slug))
        .map((t) => ({ source: d.id, target: `topic:${t.slug}`, membership: true, reason: "" })),
    ),
    ...graph.links
      .filter((l) => docIds.has(l.from) && docIds.has(l.to))
      .map((l) => ({ source: l.from, target: l.to, membership: false, reason: l.reason })),
  ];

  if (bare.length === 0)
    return { nodes: [], edges: [], viewBox: { x: 0, y: 0, width: 800, height: 500 } };

  const simNodes: SimNode[] = bare.map(({ key, r }) => ({ key, r }));
  const simLinks: SimLink[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    membership: e.membership,
  }));
  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((n) => n.key)
        .distance(70)
        .strength((l) => (l.membership ? 0.25 : 0.6)),
    )
    .force("charge", forceManyBody<SimNode>().strength(charge))
    .force("collide", forceCollide<SimNode>((n) => n.r + 16))
    .force("x", forceX<SimNode>(0).strength(0.05))
    .force("y", forceY<SimNode>(0).strength(0.06))
    .stop();
  for (let i = 0; i < TICKS; i++) sim.tick();

  const nodes = bare.map((n, i) => ({ ...n, x: simNodes[i].x ?? 0, y: simNodes[i].y ?? 0 }));
  const pad = 56; // room for labels at the rim
  const minX = Math.min(...nodes.map((n) => n.x)) - pad;
  const maxX = Math.max(...nodes.map((n) => n.x)) + pad;
  const minY = Math.min(...nodes.map((n) => n.y)) - pad;
  const maxY = Math.max(...nodes.map((n) => n.y)) + pad;
  return {
    nodes,
    edges,
    viewBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
