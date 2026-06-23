import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { BrainGraph as BrainGraphData } from "../../shared/types";
import {
  DEFAULT_CHARGE,
  layoutBrainGraph,
  nodeKey,
  type BrainSelection,
  type LayoutNode,
} from "../lib/brainLayout";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;

function ariaFor(n: LayoutNode): string {
  const tail = n.hidden ? " (hidden)" : "";
  if (n.kind === "topic")
    return `Topic ${n.label}, ${n.docCount} document${n.docCount === 1 ? "" : "s"}${tail}`;
  if (n.kind === "learning") return `Learning doc ${n.label}${tail}`;
  // origin is the agent-vs-direct signal — say it, never rely on fill alone
  return `${n.origin === "agent" ? "Agent session" : "Session"} ${n.label}${tail}`;
}

export function BrainGraph({
  graph,
  showHidden,
  selected,
  multiKeys,
  highlightIds,
  onSelect,
  onClear,
}: {
  graph: BrainGraphData;
  showHidden: boolean;
  selected: BrainSelection | null;
  // Node keys cmd/ctrl-clicked into the multi-select (for overlap) — ringed.
  multiKeys: Set<string>;
  highlightIds: Set<string>;
  // additive = cmd/ctrl held (toggle into the multi-select rather than replace).
  onSelect: (sel: BrainSelection, additive: boolean) => void;
  onClear: () => void;
}) {
  // Gravity: many-body charge strength, driven by the slider (more negative =
  // more spread). Re-runs the layout when changed.
  const [charge, setCharge] = useState(DEFAULT_CHARGE);
  const layout = useMemo(
    () => layoutBrainGraph(graph, showHidden, charge),
    [graph, showHidden, charge],
  );
  const vb = layout.viewBox;
  const byKey = useMemo(
    () => new Map(layout.nodes.map((n) => [n.key, n])),
    [layout],
  );
  // Selecting dims everything outside the node's 1-hop neighborhood.
  const near = useMemo(() => {
    if (!selected) return null;
    const center = nodeKey(selected);
    return new Set([
      center,
      ...layout.edges.flatMap((e) =>
        e.source === center ? [e.target] : e.target === center ? [e.source] : [],
      ),
    ]);
  }, [selected, layout]);

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => setView({ x: 0, y: 0, k: 1 }), [layout]);

  // React's onWheel is passive, so preventDefault (to stop page scroll while
  // zooming) needs a native listener.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      setView((v) => {
        const k = clamp(v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.4, 3);
        // keep the world point under the cursor fixed while scaling
        const px = vb.x + ((e.clientX - rect.left) / rect.width) * vb.width;
        const py = vb.y + ((e.clientY - rect.top) / rect.height) * vb.height;
        return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [vb]);

  // Bring an offscreen selection (e.g. a search hit) back into view.
  useEffect(() => {
    if (!selected) return;
    const node = byKey.get(nodeKey(selected));
    if (!node) return;
    setView((v) => {
      const sx = v.x + node.x * v.k;
      const sy = v.y + node.y * v.k;
      const visible =
        sx > vb.x && sx < vb.x + vb.width && sy > vb.y && sy < vb.y + vb.height;
      if (visible) return v;
      return {
        ...v,
        x: vb.x + vb.width / 2 - node.x * v.k,
        y: vb.y + vb.height / 2 - node.y * v.k,
      };
    });
  }, [selected, byKey, vb]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget) return; // node clicks aren't pans
    dragFrom.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const from = dragFrom.current;
    if (!from) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - from.x) / rect.width) * vb.width;
    const dy = ((e.clientY - from.y) / rect.height) * vb.height;
    dragFrom.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const endDrag = () => {
    dragFrom.current = null;
  };

  if (graph.topics.length === 0 && graph.links.length === 0)
    return (
      <p className="muted brain-graph-empty">
        Nothing connected yet — the next brain sweep will wire topics and links
        into the map.
      </p>
    );

  const hasSelection = selected !== null || multiKeys.size > 0;
  const zoomBy = (factor: number) =>
    setView((v) => ({ ...v, k: clamp(v.k * factor, ZOOM_MIN, ZOOM_MAX) }));

  return (
    <>
    <div className="bg-controls">
      <div className="bg-zoom" role="group" aria-label="Zoom">
        <button className="btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          −
        </button>
        <button
          className="btn"
          aria-label="Reset zoom"
          title="Reset zoom"
          onClick={() => setView({ x: 0, y: 0, k: 1 })}
        >
          ⌖
        </button>
        <button className="btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.2)}>
          +
        </button>
      </div>
      <label className="bg-gravity" title="Spread nodes apart or pull them together">
        <span className="bg-gravity-label">Gravity</span>
        <input
          type="range"
          min={-400}
          max={-40}
          step={20}
          // left = stronger repulsion (spread out); right = weaker (cluster)
          value={charge}
          aria-label="Gravity (node spread)"
          onChange={(e) => setCharge(Number(e.target.value))}
        />
      </label>
      {hasSelection && (
        <button className="btn bg-clear" onClick={onClear}>
          Clear selection
        </button>
      )}
    </div>
    <svg
      ref={svgRef}
      className="brain-graph"
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      aria-label="Knowledge graph"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {layout.edges.map((e, i) => {
          const a = byKey.get(e.source)!;
          const b = byKey.get(e.target)!;
          const dim = near && !(near.has(e.source) && near.has(e.target));
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`bg-edge ${e.membership ? "membership" : "link"}${dim ? " dim" : ""}`}
            >
              {!e.membership && <title>{e.reason}</title>}
            </line>
          );
        })}

        {layout.nodes.map((n) => {
          const isSelected = selected !== null && nodeKey(selected) === n.key;
          const inMulti = multiKeys.has(n.key);
          const hit = highlightIds.has(n.key);
          const dim = near && !near.has(n.key);
          const agent = n.origin === "agent";
          const labeled =
            n.kind === "topic" || isSelected || inMulti || hit || hovered === n.key;
          return (
            <g
              key={n.key}
              transform={`translate(${n.x} ${n.y})`}
              className={`bg-node ${n.kind}${agent ? " agent" : ""}${n.hidden ? " hidden" : ""}${isSelected ? " selected" : ""}${inMulti ? " multi" : ""}${dim ? " dim" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={ariaFor(n)}
              onClick={(e) => onSelect(n.sel, e.metaKey || e.ctrlKey)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(n.sel, e.metaKey || e.ctrlKey);
                }
              }}
              onPointerEnter={() => setHovered(n.key)}
              onPointerLeave={() => setHovered(null)}
            >
              {inMulti && <circle className="bg-multi-ring" r={n.r + 5} />}
              {hit && <circle className="bg-ring" r={n.r + 5} />}
              {n.kind === "learning" ? (
                <rect
                  x={-n.r}
                  y={-n.r}
                  width={n.r * 2}
                  height={n.r * 2}
                  rx={2}
                  transform="rotate(45)"
                />
              ) : (
                <circle r={n.r} />
              )}
              {/* agent sessions earn a 🤖 affordance on top of the hollow fill so
                  the agent-vs-direct signal carries without leaning on color */}
              {agent && (
                <text className="bg-agent-mark" textAnchor="middle" dominantBaseline="central">
                  🤖
                </text>
              )}
              {labeled ? (
                <text y={n.r + 14} textAnchor="middle">
                  {n.short}
                </text>
              ) : (
                <title>{n.label}</title>
              )}
            </g>
          );
        })}
      </g>
    </svg>
    <ul className="bg-legend" aria-label="Legend">
      <li className="bg-legend-item">
        <span className="bg-swatch topic" aria-hidden /> topic
      </li>
      <li className="bg-legend-item">
        <span className="bg-swatch learning" aria-hidden /> learning
      </li>
      <li className="bg-legend-item">
        <span className="bg-swatch session" aria-hidden /> session
      </li>
      <li className="bg-legend-item">
        <span className="bg-swatch session agent" aria-hidden /> 🤖 agent session
      </li>
    </ul>
    </>
  );
}
