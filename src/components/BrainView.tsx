import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  BrainDiscovery,
  BrainDiscoveryKind,
  BrainDocKind,
  BrainGraph as BrainGraphData,
  BrainGraphDoc,
  BrainHidden,
  BrainSearchResult,
  BrainSweepJob,
  BrainVerdict,
  BrainVerification,
} from "../../shared/types";
import { api } from "../api";
import { SOURCE_META } from "../sources";
import { shortDate } from "../lib/time";
import { discoveryHighlightKeys, nodeKey, type BrainSelection } from "../lib/brainLayout";
import { BrainGraph } from "./BrainGraph";
import { Markdown } from "./Md";

const KIND_ICON: Record<BrainDocKind, string> = { learning: "📚", session: "🧵" };
const TOPIC_ICON = "⊚";

// Glyph + word + accent border per kind — color is never the only signal.
// Accents reuse existing source tokens so the palette stays calm.
const DISCOVERY_KIND: Record<BrainDiscoveryKind, { icon: string; label: string; color: string }> = {
  trend: { icon: "📈", label: "trend", color: "var(--color-done)" },
  thread: { icon: "🪢", label: "thread", color: "var(--color-claude-sessions)" },
  pattern: { icon: "🔁", label: "pattern", color: "var(--color-learnings)" },
  fix: { icon: "🔧", label: "fix", color: "var(--color-email)" },
  // Cross-cutting kinds — the non-obvious insights. Accents reuse existing
  // source tokens so the palette stays calm; glyph + word carry the meaning.
  correlation: { icon: "🔗", label: "correlation", color: "var(--color-current)" },
  contradiction: { icon: "⚖", label: "contradiction", color: "var(--color-slack)" },
  silence: { icon: "🌙", label: "silence", color: "var(--color-notion)" },
};

// Hypotheses group into collapsible sections in this fixed reading order. The
// cross-cutting kinds lead — they're the point of the synthesis pass.
const KIND_ORDER: BrainDiscoveryKind[] = [
  "correlation",
  "contradiction",
  "silence",
  "thread",
  "trend",
  "fix",
  "pattern",
];

// Verdicts and statuses always render glyph + word — never color alone.
const VERDICT_BADGE: Record<BrainVerdict, { icon: string; word: string }> = {
  confirmed: { icon: "✓", word: "confirmed" },
  partial: { icon: "◐", word: "partial" },
  refuted: { icon: "✗", word: "refuted" },
  inconclusive: { icon: "?", word: "inconclusive" },
};
const verificationBadge = (v: BrainVerification): { icon: string; word: string } =>
  v.status === "running"
    ? { icon: "…", word: "verifying" }
    : v.status === "failed"
      ? { icon: "⚠", word: "verification failed" }
      : v.status === "deferred"
        ? { icon: "⏸", word: "deferred" }
        : v.status === "done" && v.verdict
          ? VERDICT_BADGE[v.verdict]
          : { icon: "⏳", word: "not yet verified" };

// A discovery is "internal/meta" when most of its resolved evidence docs are
// agent-origin sessions — AI-to-AI chatter, not the user's direct conversations.
const isMetaDiscovery = (
  d: Pick<BrainDiscovery, "docs">,
  docsById: Map<string, BrainGraphDoc>,
): boolean => {
  const resolved = d.docs.flatMap((id) => docsById.get(id) ?? []);
  const agent = resolved.filter((doc) => doc.origin === "agent").length;
  return resolved.length > 0 && agent * 2 > resolved.length;
};

// Optimistic mirror of the server's hide registry: docs hide by id, topics by
// slug. Pure — returns a fresh BrainHidden so React sees a new graph.
const patchHidden = (
  prev: BrainHidden,
  kind: "doc" | "topic",
  id: string,
  hidden: boolean,
): BrainHidden => {
  const key = kind === "doc" ? "docs" : "topics";
  const without = prev[key].filter((x) => x !== id);
  return { ...prev, [key]: hidden ? [...without, id] : without };
};

// Evidence cites systems by bare name ("slack", "github", "datadog"…). Reuse the
// dashboard's source meta when one matches; unknown systems get a link glyph.
const EVIDENCE_META: ReadonlyMap<string, { icon: string; label: string }> = new Map(
  Object.entries(SOURCE_META),
);
const evidenceMeta = (source: string) =>
  EVIDENCE_META.get(source.toLowerCase()) ?? { icon: "🔗", label: source };

const COLLAPSE_KEY = "dayboard:brain-discoveries-collapsed";
const SHOW_HIDDEN_KEY = "dayboard:brain-show-hidden";

// localStorage may be unavailable (private mode, test stubs) — degrade quietly.
function loadCollapsedKinds(): Set<BrainDiscoveryKind> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function saveCollapsedKinds(kinds: Set<BrainDiscoveryKind>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...kinds]));
  } catch {
    // ignore — preference just won't persist
  }
}
function loadShowHidden(): boolean {
  try {
    return localStorage.getItem(SHOW_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}
function saveShowHidden(showHidden: boolean): void {
  try {
    localStorage.setItem(SHOW_HIDDEN_KEY, showHidden ? "1" : "0");
  } catch {
    // ignore — preference just won't persist
  }
}

const count = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;

function SweepBanner({ job }: { job: BrainSweepJob }) {
  return (
    <div className="sweep-progress" role="status" aria-live="polite">
      <span className="sweep-spinner" aria-hidden>
        ↻
      </span>
      <span className="sweep-progress-title">Sweeping your brain…</span>
      <span className="muted">
        {job.synthesizing
          ? "synthesizing discoveries…"
          : job.verifyTotal > 0
            ? `verifying hypotheses ${job.verified}/${job.verifyTotal}…${
                job.verifyDeferred > 0 ? ` (${job.verifyDeferred} deferred — usage limit)` : ""
              }`
            : // the topic-summary pass runs after indexing, before synthesis
              job.topicTotal > 0 && job.topicsSummarized < job.topicTotal
              ? `summarizing topics ${job.topicsSummarized}/${job.topicTotal}…`
              : job.batch === 0
                ? "scanning sources…"
                : `batch ${job.batch}/${job.batches} · ${job.done}/${job.total} docs`}
      </span>
    </div>
  );
}

// The verdict badge lives in the card header (visible collapsed too), so the
// deep dive's head carries only the checked date and the re-verify control.
function Verification({ v, onVerify }: { v: BrainVerification; onVerify: () => void }) {
  return (
    <div className="discovery-verify">
      <div className="verify-head">
        {v.checkedAt && (
          <span className="muted verify-checked">
            checked {shortDate(v.checkedAt.slice(0, 10))}
          </span>
        )}
        <button
          className="btn btn-ghost verify-again"
          disabled={v.status === "running"}
          onClick={onVerify}
        >
          ↻ Re-verify
        </button>
      </div>
      {v.status === "pending" ? (
        <p className="muted verify-pending">
          Not yet verified — the next sweep will research this against Slack,
          Linear, Datadog and friends.
        </p>
      ) : v.status === "deferred" ? (
        <p className="muted verify-pending">
          Deferred — the Claude usage limit was hit; the next sweep will retry
          this automatically.
        </p>
      ) : (
        v.detail && <Markdown>{v.detail}</Markdown>
      )}
      {v.evidence.length > 0 && (
        <ul className="evidence-list" aria-label="External evidence">
          {v.evidence.map((e, i) => {
            const meta = evidenceMeta(e.source);
            return (
              <li key={i} className="evidence-item">
                <div className="evidence-item-head">
                  <span className="evidence-source">
                    {meta.icon} {meta.label}
                  </span>
                  <span className={`evidence-stance${e.supports ? "" : " contradicts"}`}>
                    {e.supports ? "supports" : "contradicts"}
                  </span>
                </div>
                <span className="evidence-summary">{e.summary}</span>
                {e.ref &&
                  (e.ref.startsWith("http") ? (
                    <a className="evidence-ref" href={e.ref} target="_blank" rel="noreferrer">
                      {e.ref}
                    </a>
                  ) : (
                    <code className="evidence-ref">{e.ref}</code>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DiscoveryCard({
  discovery: d,
  expanded,
  meta,
  topicLabels,
  docsById,
  onToggle,
  onSelectTopic,
  onSelectDoc,
  onDismiss,
  onHide,
  onVerify,
}: {
  discovery: BrainDiscovery;
  expanded: boolean;
  meta: boolean;
  topicLabels: Map<string, string>;
  docsById: Map<string, BrainGraphDoc>;
  onToggle: () => void;
  onSelectTopic: (slug: string) => void;
  onSelectDoc: (id: string) => void;
  onDismiss: () => void;
  onHide: (hidden: boolean) => void;
  onVerify: () => void;
}) {
  const kind = DISCOVERY_KIND[d.kind];
  const verdict = verificationBadge(d.verification);
  const sourceDocs = d.docs.flatMap((id) => docsById.get(id) ?? []);
  // Anywhere on a collapsed card opens the deep dive; collapsing is deliberate
  // (the title button), so clicks inside the expanded content — links, text
  // selection, evidence — never snap it shut. Nested controls stop propagation
  // so a chip or dismiss click never also expands.
  return (
    <article
      className={`discovery card${expanded ? " expanded" : ""}${d.hidden ? " hidden" : ""}`}
      style={{ ["--kind" as string]: kind.color }}
      onClick={() => {
        if (!expanded) onToggle();
      }}
    >
      <header className="discovery-head">
        <span className="discovery-kind">
          {kind.icon} {kind.label}
        </span>
        {/* the verdict reads at a glance — collapsed or expanded, glyph + word */}
        <span className="verify-badge discovery-verdict">
          {verdict.icon} {verdict.word}
        </span>
        {meta && (
          <span className="discovery-meta-tag" title="Sourced from automated agent sessions">
            🤖 internal
          </span>
        )}
        {d.hidden && <span className="discovery-hidden-tag">hidden</span>}
        <span className="discovery-head-actions">
          {d.hidden ? (
            <button
              className="discovery-x"
              aria-label={`Unhide discovery: ${d.title}`}
              title="Unhide"
              onClick={(e) => {
                e.stopPropagation();
                onHide(false);
              }}
            >
              👁
            </button>
          ) : (
            <button
              className="discovery-x"
              aria-label={`Hide (reversible): ${d.title}`}
              title="Hide (reversible)"
              onClick={(e) => {
                e.stopPropagation();
                onHide(true);
              }}
            >
              🙈
            </button>
          )}
          <button
            className="discovery-x"
            aria-label={`Dismiss (permanent): ${d.title}`}
            title="Dismiss (permanent)"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
          >
            ✕
          </button>
        </span>
      </header>
      <button
        className="discovery-title"
        aria-expanded={expanded}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {d.title}
      </button>
      <p className="discovery-insight">{d.insight}</p>
      {expanded && (
        <div className="discovery-deep">
          {meta && (
            <p className="muted discovery-meta-note">
              Sourced from automated agent sessions (AI-to-AI), not your direct
              conversations.
            </p>
          )}
          <Verification v={d.verification} onVerify={onVerify} />
          {sourceDocs.length > 0 && (
            <>
              <div className="side-label">Internal sources</div>
              {sourceDocs.map((doc) => (
                <button key={doc.id} className="brain-doc-row" onClick={() => onSelectDoc(doc.id)}>
                  <span className="brain-doc-title">
                    {KIND_ICON[doc.kind]} {doc.title}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      <footer className="discovery-foot">
        {d.topics.map((slug) => (
          <button
            key={slug}
            className="ed-chip discovery-chip"
            onClick={(e) => {
              e.stopPropagation();
              onSelectTopic(slug);
            }}
          >
            {TOPIC_ICON} {topicLabels.get(slug) ?? slug}
          </button>
        ))}
        <span className="muted discovery-count">{count(d.docs.length, "doc")}</span>
      </footer>
    </article>
  );
}

function DiscoverySection({
  kind,
  items,
  collapsed,
  onToggleCollapsed,
  children,
}: {
  kind: BrainDiscoveryKind;
  items: BrainDiscovery[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  children: ReactNode;
}) {
  const meta = DISCOVERY_KIND[kind];
  // "deferred" is a soft pause, not an unresolved hypothesis — flag it apart.
  const unverified = items.filter(
    (d) => d.verification.status !== "done" && d.verification.status !== "deferred",
  ).length;
  const deferred = items.filter((d) => d.verification.status === "deferred").length;
  const refuted = items.filter((d) => d.verification.verdict === "refuted").length;
  return (
    <section className="discovery-section">
      <button
        className="discovery-section-head"
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        <span className="discovery-chevron" aria-hidden>
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="discovery-section-title">
          {meta.icon} {meta.label}
        </span>
        <span className="discovery-section-count">{items.length}</span>
        {unverified > 0 && (
          <span className="discovery-section-flags">{unverified} unverified</span>
        )}
        {deferred > 0 && (
          <span className="discovery-section-flags">{deferred} deferred</span>
        )}
        {refuted > 0 && <span className="discovery-section-flags">{refuted} refuted</span>}
      </button>
      {!collapsed && <div className="discovery-grid">{children}</div>}
    </section>
  );
}

function Discoveries({
  discoveries,
  expandedId,
  topicLabels,
  docsById,
  onToggleCard,
  onSelectTopic,
  onSelectDoc,
  onDismiss,
  onHide,
  onVerify,
}: {
  discoveries: BrainDiscovery[];
  expandedId: string | null;
  topicLabels: Map<string, string>;
  docsById: Map<string, BrainGraphDoc>;
  onToggleCard: (id: string) => void;
  onSelectTopic: (slug: string) => void;
  onSelectDoc: (id: string) => void;
  onDismiss: (d: BrainDiscovery) => void;
  onHide: (d: BrainDiscovery, hidden: boolean) => void;
  onVerify: (d: BrainDiscovery) => void;
}) {
  const [collapsed, setCollapsed] = useState(loadCollapsedKinds);
  useEffect(() => {
    saveCollapsedKinds(collapsed);
  }, [collapsed]);

  if (discoveries.length === 0)
    return (
      <p className="muted">
        No cross-document discoveries yet — they emerge as the graph grows.
      </p>
    );

  const sections = KIND_ORDER.map((kind) => ({
    kind,
    items: discoveries.filter((d) => d.kind === kind),
  })).filter((s) => s.items.length > 0);
  const toggleCollapsed = (kind: BrainDiscoveryKind) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });

  return (
    <section className="discoveries" aria-label="Discoveries">
      <h2 className="discoveries-title">✨ Discoveries</h2>
      {sections.map(({ kind, items }) => (
        <DiscoverySection
          key={kind}
          kind={kind}
          items={items}
          collapsed={collapsed.has(kind)}
          onToggleCollapsed={() => toggleCollapsed(kind)}
        >
          {items.map((d) => (
            <DiscoveryCard
              key={d.id}
              discovery={d}
              expanded={d.id === expandedId}
              meta={isMetaDiscovery(d, docsById)}
              topicLabels={topicLabels}
              docsById={docsById}
              onToggle={() => onToggleCard(d.id)}
              onSelectTopic={onSelectTopic}
              onSelectDoc={onSelectDoc}
              onDismiss={() => onDismiss(d)}
              onHide={(hidden) => onHide(d, hidden)}
              onVerify={() => onVerify(d)}
            />
          ))}
        </DiscoverySection>
      ))}
    </section>
  );
}

// The results panel doubles as the screen-reader path into the graph.
function SearchResults({
  results,
  onSelect,
}: {
  results: BrainSearchResult;
  onSelect: (sel: BrainSelection) => void;
}) {
  return (
    <ul className="brain-results card" aria-label="Search results">
      {results.topics.map((t) => (
        <li key={t.slug}>
          <button
            className="brain-result"
            onClick={() => onSelect({ type: "topic", id: t.slug })}
          >
            <span className="brain-result-title">
              {TOPIC_ICON} {t.label}
            </span>
            <span className="brain-excerpt">{count(t.docCount, "doc")}</span>
          </button>
        </li>
      ))}
      {results.docs.map((d) => (
        <li key={d.id}>
          <button
            className="brain-result"
            onClick={() => onSelect({ type: "doc", id: d.id })}
          >
            <span className="brain-result-title">
              {KIND_ICON[d.kind]} {d.title}
            </span>
            {d.matches.slice(0, 2).map((m, i) => (
              <span key={i} className="brain-excerpt">
                {m.snippet}
              </span>
            ))}
          </button>
        </li>
      ))}
      {results.topics.length === 0 && results.docs.length === 0 && (
        <li className="muted brain-no-results">No matches.</li>
      )}
    </ul>
  );
}

function TopicDetail({
  topic,
  docs,
  hidden,
  onHide,
  onSelectDoc,
}: {
  topic: BrainGraphData["topics"][number];
  docs: BrainGraphDoc[];
  hidden: boolean;
  onHide: (hidden: boolean) => void;
  onSelectDoc: (id: string) => void;
}) {
  return (
    <>
      <h2 className="brain-detail-title">
        {TOPIC_ICON} {topic.label}
      </h2>
      {topic.description && <p className="brain-detail-summary">{topic.description}</p>}
      {/* The synthesis across every member doc reads as its own thing, set off
          from the terse one-line description above it. Plain paragraph, like
          the discovery insight — never Markdown. */}
      <div className="side-label">Key findings</div>
      {topic.summary ? (
        <p className="brain-topic-summary">{topic.summary}</p>
      ) : (
        <p className="muted brain-topic-summary-empty">
          No summary yet — the next brain sweep will write one.
        </p>
      )}
      <HideNodeButton hidden={hidden} onHide={onHide} />
      <div className="side-label">Documents ({docs.length})</div>
      {docs.map((d) => {
        const excerpt = d.topics.find((t) => t.slug === topic.slug)?.excerpt;
        return (
          <button
            key={d.id}
            className="brain-doc-row"
            onClick={() => onSelectDoc(d.id)}
          >
            <span className="brain-doc-title">
              {KIND_ICON[d.kind]} {d.title}
            </span>
            {excerpt && <span className="brain-excerpt">“{excerpt}”</span>}
          </button>
        );
      })}
    </>
  );
}

// One reversible control for both node detail panels — "Hide from map" /
// "Unhide", never a delete.
function HideNodeButton({ hidden, onHide }: { hidden: boolean; onHide: (hidden: boolean) => void }) {
  return (
    <button className="btn btn-ghost brain-hide" onClick={() => onHide(!hidden)}>
      {hidden ? "👁 Unhide" : "🙈 Hide from map"}
    </button>
  );
}

function DocDetail({
  doc,
  graph,
  hidden,
  onHide,
  onSelect,
  onOpen,
}: {
  doc: BrainGraphDoc;
  graph: BrainGraphData;
  hidden: boolean;
  onHide: (hidden: boolean) => void;
  onSelect: (sel: BrainSelection) => void;
  onOpen: () => void;
}) {
  const byId = new Map(graph.docs.filter((d) => !d.missing).map((d) => [d.id, d]));
  const topicLabels = new Map(graph.topics.map((t) => [t.slug, t.label]));

  const related = (label: string, rows: Array<{ other: BrainGraphDoc; reason: string }>) =>
    rows.length > 0 && (
      <>
        <div className="side-label">{label}</div>
        {rows.map(({ other, reason }) => (
          <button
            key={other.id}
            className="brain-doc-row"
            onClick={() => onSelect({ type: "doc", id: other.id })}
          >
            <span className="brain-doc-title">
              {KIND_ICON[other.kind]} {other.title}
            </span>
            <span className="brain-excerpt">{reason}</span>
          </button>
        ))}
      </>
    );
  const resolve = (ids: Array<{ id: string; reason: string }>) =>
    ids.flatMap(({ id, reason }) => {
      const other = byId.get(id);
      return other ? [{ other, reason }] : [];
    });
  const linksTo = resolve(
    graph.links.filter((l) => l.from === doc.id).map((l) => ({ id: l.to, reason: l.reason })),
  );
  const linkedFrom = resolve(
    graph.links.filter((l) => l.to === doc.id).map((l) => ({ id: l.from, reason: l.reason })),
  );

  return (
    <>
      <h2 className="brain-detail-title">
        {KIND_ICON[doc.kind]} {doc.title}
      </h2>
      <p className="muted brain-detail-meta">
        {doc.kind}
        {doc.date && ` · ${shortDate(doc.date)}`}
      </p>
      {doc.summary && <p className="brain-detail-summary">{doc.summary}</p>}
      {!doc.missing && (
        <button className="btn btn-primary brain-open" onClick={onOpen}>
          Open document →
        </button>
      )}
      <HideNodeButton hidden={hidden} onHide={onHide} />

      {doc.topics.length > 0 && (
        <>
          <div className="side-label">Topics</div>
          {doc.topics.map((t) => (
            <button
              key={t.slug}
              className="brain-doc-row"
              onClick={() => onSelect({ type: "topic", id: t.slug })}
            >
              <span className="brain-doc-title">
                {TOPIC_ICON} {topicLabels.get(t.slug) ?? t.slug}
              </span>
              {t.excerpt && <span className="brain-excerpt">“{t.excerpt}”</span>}
            </button>
          ))}
        </>
      )}

      {related("Links to", linksTo)}
      {related("Linked from", linkedFrom)}
    </>
  );
}

// Shown in the detail pane when 2+ topics are picked. Runs a focused synthesis
// of just those topics and renders the markdown verdict.
function OverlapPanel({
  labels,
  busy,
  error,
  result,
  onRun,
  hint,
}: {
  labels: string[];
  busy: boolean;
  error: string | null;
  result: { markdown: string } | null;
  onRun: () => void;
  hint: string;
}) {
  return (
    <div className="brain-overlap">
      <h2 className="brain-detail-title">Overlap</h2>
      <p className="muted brain-overlap-topics">{labels.join(" ∩ ")}</p>
      <button className="btn btn-primary" onClick={onRun} disabled={busy}>
        {busy ? "Surfacing…" : result ? "↻ Re-run overlap" : "✨ Surface overlap"}
      </button>
      {!result && !busy && <p className="muted brain-overlap-hint">{hint}</p>}
      {error && <p style={{ color: "var(--color-email)" }}>✗ {error}</p>}
      {result && (
        <div className="brain-overlap-result">
          <Markdown>{result.markdown}</Markdown>
        </div>
      )}
    </div>
  );
}

export function BrainView({
  onOpenLearning,
  onOpenSession,
}: {
  onOpenLearning: (file: string) => void;
  onOpenSession: (id: string) => void;
}) {
  const [graph, setGraph] = useState<BrainGraphData | null>(null);
  const [discoveries, setDiscoveries] = useState<BrainDiscovery[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(loadShowHidden);
  const [job, setJob] = useState<BrainSweepJob | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrainSearchResult | null>(null);
  const [selected, setSelected] = useState<BrainSelection | null>(null);
  // Topics cmd/ctrl-clicked for an overlap comparison (slugs). 2+ enables the
  // "Surface overlap" action; the result is ephemeral (re-run any time).
  const [overlapTopics, setOverlapTopics] = useState<string[]>([]);
  const [overlap, setOverlap] = useState<{ topics: { slug: string; label: string }[]; markdown: string } | null>(null);
  const [overlapBusy, setOverlapBusy] = useState(false);
  const [overlapErr, setOverlapErr] = useState<string | null>(null);
  // error kills the view (graph never loaded); notice is a recoverable hiccup
  // (search, poll, sweep-start, dismiss) shown inline so the graph stays usable.
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadGraph = useCallback(
    () => api.getBrainGraph().then(setGraph).catch((e) => setError(String(e))),
    [],
  );
  // Discoveries are an enhancement — a failed load is a notice, not fatal.
  const loadDiscoveries = useCallback(
    () => api.getDiscoveries().then(setDiscoveries).catch((e) => setNotice(String(e))),
    [],
  );

  useEffect(() => {
    loadGraph();
    loadDiscoveries();
    // Pick up a sweep already running (cron, another tab) so polling engages.
    api.getBrainSweep().then(setJob).catch(() => {});
  }, [loadGraph, loadDiscoveries]);

  useEffect(() => {
    saveShowHidden(showHidden);
  }, [showHidden]);

  // Self-rescheduling poll (the App.tsx sweep pattern): every fetched job is a
  // fresh object, so this effect re-queues until the sweep settles.
  useEffect(() => {
    if (job?.status !== "running") return;
    const id = setTimeout(
      () =>
        api
          .getBrainSweep()
          .then((next) => {
            setJob(next);
            if (next?.status !== "running") {
              loadGraph();
              loadDiscoveries();
            }
          })
          .catch((e) => setNotice(String(e))),
      2500,
    );
    return () => clearTimeout(id);
  }, [job, loadGraph, loadDiscoveries]);

  // While verification research is live — a sweep, or any hypothesis flipped
  // to running — keep discoveries fresh so status changes land without a
  // reload. Same self-rescheduling setTimeout shape as the sweep poll above.
  useEffect(() => {
    const verifying = discoveries?.some((d) => d.verification.status === "running");
    if (!verifying && job?.status !== "running") return;
    const id = setTimeout(
      () => api.getDiscoveries().then(setDiscoveries).catch((e) => setNotice(String(e))),
      4000,
    );
    return () => clearTimeout(id);
  }, [discoveries, job]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const id = setTimeout(
      () => api.searchBrain(q).then(setResults).catch((e) => setNotice(String(e))),
      250,
    );
    return () => clearTimeout(id);
  }, [query]);

  // A stale expanded id (retired or dismissed since) simply finds nothing.
  const expanded = discoveries?.find((d) => d.id === expandedId) ?? null;
  // An active search owns the highlights; the expanded discovery takes over
  // only while the query is clear, so the two never fight.
  const highlightIds = useMemo(() => {
    if (results)
      return new Set([
        ...results.topics.map((t) => nodeKey({ type: "topic", id: t.slug })),
        ...results.docs.map((d) => d.id),
      ]);
    return expanded ? discoveryHighlightKeys(expanded) : new Set<string>();
  }, [results, expanded]);

  const sweep = () => {
    setNotice(null);
    api.startBrainSweep().then(setJob).catch((e) => setNotice(String(e)));
  };
  const dismiss = (d: BrainDiscovery) => {
    // Optimistic: the card vanishes now; a failed call puts it back (in the
    // server's lastSeen-desc order) alongside the hiccup notice.
    setDiscoveries((prev) => (prev ?? []).filter((x) => x.id !== d.id));
    if (expandedId === d.id) setExpandedId(null);
    api.dismissDiscovery(d.id).catch((e) => {
      setDiscoveries((prev) =>
        [...(prev ?? []), d].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)),
      );
      setNotice(String(e));
    });
  };
  const verify = (d: BrainDiscovery) => {
    // Optimistic running: the live poll picks it up and follows the server's
    // truth from there. A 409 (already running) just lands as a notice; the
    // optimistic state was right anyway.
    setNotice(null);
    setDiscoveries((prev) =>
      (prev ?? []).map((x) =>
        x.id === d.id
          ? { ...x, verification: { ...x.verification, status: "running" as const } }
          : x,
      ),
    );
    api
      .verifyDiscovery(d.id)
      .then((rec) =>
        setDiscoveries((prev) => (prev ?? []).map((x) => (x.id === rec.id ? rec : x))),
      )
      .catch((e) => setNotice(String(e)));
  };
  // Optimistic flip of d.hidden; the visible-list filter does the showing and
  // hiding. A failed call reverts the one record and surfaces a notice.
  const hideDiscovery = (d: BrainDiscovery, hidden: boolean) => {
    setNotice(null);
    setDiscoveries((prev) =>
      (prev ?? []).map((x) => (x.id === d.id ? { ...x, hidden } : x)),
    );
    api.hideDiscovery(d.id, hidden).catch((e) => {
      setDiscoveries((prev) =>
        (prev ?? []).map((x) => (x.id === d.id ? { ...x, hidden: !hidden } : x)),
      );
      setNotice(String(e));
    });
  };
  // Hiding a node mutates the graph's hidden registry; the layout reads it, so
  // optimistically patch graph.hidden and reconcile with the server's truth.
  const hideNode = (kind: "doc" | "topic", id: string, hidden: boolean) => {
    setNotice(null);
    setGraph((prev) => (prev ? { ...prev, hidden: patchHidden(prev.hidden, kind, id, hidden) } : prev));
    api
      .hideNode(kind, id, hidden)
      .then((next) => setGraph((prev) => (prev ? { ...prev, hidden: next } : prev)))
      .catch((e) => {
        setGraph((prev) =>
          prev ? { ...prev, hidden: patchHidden(prev.hidden, kind, id, !hidden) } : prev,
        );
        setNotice(String(e));
      });
  };
  const openDoc = (id: string) =>
    id.startsWith("learning:")
      ? onOpenLearning(id.slice("learning:".length))
      : onOpenSession(id.slice("session:".length));

  if (error) return <p style={{ color: "var(--color-email)" }}>✗ {error}</p>;
  if (!graph) return <p className="muted">…</p>;

  const sweepBanner = job?.status === "running" ? <SweepBanner job={job} /> : null;
  const sweepError =
    job?.status === "error" && job.error ? (
      <p style={{ color: "var(--color-email)" }}>✗ {job.error}</p>
    ) : null;
  const hiccup = notice ? (
    <p style={{ color: "var(--color-email)" }}>✗ {notice}</p>
  ) : null;

  if (graph.sweptAt === null && graph.docs.length === 0)
    return (
      <div className="brain-intro card">
        <h1>🧠 Brain</h1>
        <p>
          The Brain is a map of your knowledge: learnings docs, Claude
          sessions, the topics running through them, and the links between
          related thoughts. A sweep asks Claude to read what's new and wire it
          into the map.
        </p>
        {sweepBanner ?? (
          <button className="btn btn-primary" onClick={sweep}>
            🧠 Run first brain sweep
          </button>
        )}
        {sweepError}
        {hiccup}
      </div>
    );

  const selectedTopic =
    selected?.type === "topic"
      ? (graph.topics.find((t) => t.slug === selected.id) ?? null)
      : null;
  const selectedDoc =
    selected?.type === "doc"
      ? (graph.docs.find((d) => d.id === selected.id) ?? null)
      : null;
  const memberDocs = selectedTopic
    ? graph.docs.filter(
        (d) => !d.missing && d.topics.some((t) => t.slug === selectedTopic.slug),
      )
    : [];

  // Hidden discoveries stay out of the default view; "Show hidden" reveals them
  // ghosted. The toggle's N spans both hidden nodes and hidden discoveries.
  const hiddenDocs = new Set(graph.hidden.docs);
  const hiddenTopics = new Set(graph.hidden.topics);
  const visibleDiscoveries = (discoveries ?? []).filter((d) => showHidden || !d.hidden);
  const hiddenDiscoveryCount = (discoveries ?? []).filter((d) => d.hidden).length;
  const hiddenCount =
    graph.hidden.docs.length + graph.hidden.topics.length + hiddenDiscoveryCount;

  // Graph clicks: a plain click single-selects (and resets any overlap pick);
  // cmd/ctrl-click on a topic toggles it into the overlap set. Docs never join
  // an overlap. Any change invalidates a stale overlap result.
  const onGraphSelect = (sel: BrainSelection, additive: boolean) => {
    setOverlap(null);
    setOverlapErr(null);
    setSelected(sel);
    if (sel.type !== "topic") {
      setOverlapTopics([]);
      return;
    }
    setOverlapTopics((prev) =>
      additive
        ? prev.includes(sel.id)
          ? prev.filter((s) => s !== sel.id)
          : [...prev, sel.id]
        : [sel.id],
    );
  };
  const clearSelection = () => {
    setSelected(null);
    setOverlapTopics([]);
    setOverlap(null);
    setOverlapErr(null);
  };
  const runOverlap = () => {
    setOverlapBusy(true);
    setOverlapErr(null);
    api
      .surfaceOverlap(overlapTopics)
      .then(setOverlap)
      .catch((e) => setOverlapErr(String(e instanceof Error ? e.message : e)))
      .finally(() => setOverlapBusy(false));
  };
  // Plain expressions, NOT useMemo: this sits below the component's early
  // returns, so a hook here would violate rules-of-hooks. Cheap enough anyway.
  const multiKeys = new Set(overlapTopics.map((s) => nodeKey({ type: "topic", id: s })));
  const overlapLabels = overlapTopics.map(
    (s) => graph.topics.find((t) => t.slug === s)?.label ?? s,
  );

  return (
    <div className="brain">
      <header className="brain-head">
        <h1>🧠 Brain</h1>
        <span className="muted">
          {count(graph.docs.length, "doc")} · {count(graph.topics.length, "topic")} ·{" "}
          {count(graph.links.length, "link")}
        </span>
        {graph.unindexed > 0 && (
          <span className="muted">· {graph.unindexed} not yet swept</span>
        )}
        {hiddenCount > 0 && (
          <button
            className="btn btn-ghost brain-show-hidden"
            aria-pressed={showHidden}
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
          </button>
        )}
        <button
          className="btn brain-sweep-btn"
          onClick={sweep}
          disabled={job?.status === "running"}
        >
          ↻ Sweep brain
        </button>
      </header>

      {sweepBanner}
      {sweepError}
      {hiccup}

      <div className="brain-search">
        <input
          className="learn-search"
          placeholder="Search your brain…"
          aria-label="Search your brain"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results && <SearchResults results={results} onSelect={setSelected} />}
      </div>

      <div className="brain-layout">
        <div className="brain-canvas card">
          <BrainGraph
            graph={graph}
            showHidden={showHidden}
            selected={selected}
            multiKeys={multiKeys}
            highlightIds={highlightIds}
            onSelect={onGraphSelect}
            onClear={clearSelection}
          />
        </div>

        <aside className="brain-detail card" aria-label="Details">
          {overlapTopics.length >= 2 ? (
            <OverlapPanel
              labels={overlapLabels}
              busy={overlapBusy}
              error={overlapErr}
              result={overlap}
              onRun={runOverlap}
              hint="⌘/Ctrl-click more topics to add them, or run the overlap."
            />
          ) : selectedTopic ? (
            <TopicDetail
              topic={selectedTopic}
              docs={memberDocs}
              hidden={hiddenTopics.has(selectedTopic.slug)}
              onHide={(hidden) => hideNode("topic", selectedTopic.slug, hidden)}
              onSelectDoc={(id) => setSelected({ type: "doc", id })}
            />
          ) : selectedDoc ? (
            <DocDetail
              doc={selectedDoc}
              graph={graph}
              hidden={hiddenDocs.has(selectedDoc.id)}
              onHide={(hidden) => hideNode("doc", selectedDoc.id, hidden)}
              onSelect={setSelected}
              onOpen={() => openDoc(selectedDoc.id)}
            />
          ) : (
            <p className="muted">Click a node — or search — to explore a thought.</p>
          )}
        </aside>
      </div>

      {/* null = still loading (or failed) — show nothing rather than a flash
          of the empty-state line. The pre-first-sweep case returned above. */}
      {discoveries && (
        <Discoveries
          discoveries={visibleDiscoveries}
          expandedId={expandedId}
          topicLabels={new Map(graph.topics.map((t) => [t.slug, t.label]))}
          docsById={new Map(graph.docs.map((d) => [d.id, d]))}
          onToggleCard={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          onSelectTopic={(slug) => setSelected({ type: "topic", id: slug })}
          onSelectDoc={(id) => setSelected({ type: "doc", id })}
          onDismiss={dismiss}
          onHide={hideDiscovery}
          onVerify={verify}
        />
      )}
    </div>
  );
}
