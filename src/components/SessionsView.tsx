import { useEffect, useMemo, useState } from "react";
import type {
  SessionCategory,
  SessionDetail,
  SessionListItem,
  SessionStats,
} from "../../shared/types";

// Filter buckets for the list. "Mine" = interactive sessions you started; the
// agent + sweep buckets are the headless flood, hidden by default.
type CatFilter = SessionCategory | "all";
const CAT_FILTERS: Array<{ id: CatFilter; label: string }> = [
  { id: "interactive", label: "Mine" },
  { id: "agent", label: "Agents" },
  { id: "sweep", label: "Sweeps" },
  { id: "all", label: "All" },
];
import { api } from "../api";
import { Markdown } from "./Md";

// Render markdown prose, or a muted placeholder when empty.
function Prose({ value, empty }: { value: string; empty: string }) {
  if (!value) return <em className="muted">{empty}</em>;
  return <Markdown>{value}</Markdown>;
}

// ---- small formatters (transcripts carry ISO timestamps) ----

function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

function duration(ms: number | null): string {
  if (!ms || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="sess-stat">
      <span className="sess-stat-label">{label}</span>
      <span className="sess-stat-value">{value}</span>
    </div>
  );
}

function StatsSidebar({
  detail,
  onOpenLearning,
}: {
  detail: SessionDetail;
  onOpenLearning: (file: string) => void;
}) {
  const s: SessionStats = detail.stats;
  return (
    <aside className="sess-stats card">
      <div className="sess-stats-group">
        <div className="side-label">Activity</div>
        <StatRow label="Duration" value={duration(s.durationMs)} />
        <StatRow label="Your prompts" value={String(s.userMessages)} />
        <StatRow label="Claude turns" value={String(s.assistantMessages)} />
        <StatRow label="Tool calls" value={String(s.toolCalls.total)} />
        <StatRow label="Web searches" value={String(s.web.searches)} />
        <StatRow label="Pages fetched" value={String(s.web.fetches)} />
      </div>

      <div className="sess-stats-group">
        <div className="side-label">Context</div>
        <StatRow label="Peak context" value={`${tokens(s.tokens.contextHighWater)} tok`} />
        <StatRow label="Output" value={`${tokens(s.tokens.totalOutput)} tok`} />
        <StatRow label="Model" value={s.models.join(", ") || "—"} />
      </div>

      {s.toolCalls.byName.length > 0 && (
        <div className="sess-stats-group">
          <div className="side-label">Top tools</div>
          {s.toolCalls.byName.slice(0, 6).map((t) => (
            <StatRow key={t.name} label={t.name} value={String(t.count)} />
          ))}
        </div>
      )}

      <div className="sess-stats-group">
        <div className="side-label">Repo</div>
        <StatRow label="Project" value={detail.project} />
        {detail.gitBranch && <StatRow label="Branch" value={detail.gitBranch} />}
      </div>

      {detail.prs.length > 0 && (
        <div className="sess-stats-group">
          <div className="side-label">Pull requests</div>
          {detail.prs.map((pr) => (
            <a key={pr.url} className="sess-link" href={pr.url} target="_blank" rel="noreferrer">
              #{pr.number} · {pr.repository.split("/").pop()}
            </a>
          ))}
        </div>
      )}

      {detail.learnings.length > 0 && (
        <div className="sess-stats-group">
          <div className="side-label">Learnings</div>
          {detail.learnings.map((l) => (
            <button
              key={l.file}
              className="sess-link"
              onClick={() => onOpenLearning(l.file)}
              title={l.file}
            >
              📚 {l.title ?? l.file}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function Transcript({ detail }: { detail: SessionDetail }) {
  return (
    <div className="sess-transcript card">
      {detail.turns.map((t, i) => (
        <div key={i} className={`sess-turn ${t.role}`}>
          <div className="sess-turn-role">{t.role === "user" ? "You" : "Claude"}</div>
          {t.text && (
            <div className="sess-turn-text">
              <Markdown>{t.text}</Markdown>
            </div>
          )}
          {t.toolCalls.map((tc, j) => (
            <div key={j} className="sess-tool">
              <span className="sess-tool-name">{tc.name}</span>
              <code className="sess-tool-detail">{tc.detail}</code>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Detail({
  id,
  onOpenLearning,
}: {
  id: string;
  onOpenLearning: (file: string) => void;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    api.getSession(id).then(setDetail).catch((e) => setError(String(e)));
  }, [id]);

  const summarize = () => {
    setSummarizing(true);
    api
      .summarizeSession(id)
      .then((summary) => setDetail((d) => (d ? { ...d, summary } : d)))
      .catch((e) => setError(String(e)))
      .finally(() => setSummarizing(false));
  };

  if (error) return <p style={{ color: "var(--color-email)" }}>✗ {error}</p>;
  if (!detail) return <p className="muted">…</p>;

  return (
    <div className="sess-detail">
      <div className="sess-main">
        <header className="sess-head card">
          <div className="sess-head-top">
            <h2 className="sess-title">{detail.title}</h2>
            {detail.running && <span className="sess-badge live">● running</span>}
          </div>
          <div className="sess-meta">
            {detail.project}
            {detail.startedAt && ` · started ${ago(detail.startedAt)}`}
            {detail.endedAt && ` · last activity ${ago(detail.endedAt)}`}
          </div>

          <div className="sess-summary">
            <div className="sess-summary-block">
              <div className="side-label">Goal</div>
              <Prose value={detail.summary?.goal ?? detail.goal} empty="No opening prompt captured." />
            </div>
            <div className="sess-summary-block">
              <div className="side-label">Result</div>
              <Prose value={detail.summary?.outcome ?? detail.results} empty="No closing message captured." />
            </div>
          </div>

          <div className="sess-summary-actions">
            <button className="btn" onClick={summarize} disabled={summarizing}>
              {summarizing
                ? "Summarizing…"
                : detail.summary
                  ? "↻ Re-summarize with Claude"
                  : "✨ Summarize with Claude"}
            </button>
            {detail.summary && (
              <span className="muted sess-summary-note">
                showing Claude's summary (raw goal/result still parsed below the fold)
              </span>
            )}
          </div>
        </header>

        <Transcript detail={detail} />
      </div>

      <StatsSidebar detail={detail} onOpenLearning={onOpenLearning} />
    </div>
  );
}

export function SessionsView({
  onOpenLearning,
  focusSession,
}: {
  onOpenLearning: (file: string) => void;
  focusSession?: string | null;
}) {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<CatFilter>("interactive");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listSessions().then(setSessions).catch((e) => setError(String(e)));
  }, []);

  // A session opened from a Brain link wins over the default selection — widen
  // to "All" so it's visible even if it's an agent/sweep session.
  useEffect(() => {
    if (focusSession) {
      setSelected(focusSession);
      setCat("all");
    }
  }, [focusSession]);

  const counts = useMemo(() => {
    const c: Record<SessionCategory, number> = { interactive: 0, agent: 0, sweep: 0 };
    for (const s of sessions ?? []) c[s.category]++;
    return c;
  }, [sessions]);

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (cat !== "all" && s.category !== cat) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.project.toLowerCase().includes(q) ||
        s.goalPreview.toLowerCase().includes(q)
      );
    });
  }, [sessions, query, cat]);

  // Default the selection to the first visible session (so flipping to "Mine"
  // lands on a real one), unless the current pick is already in view.
  useEffect(() => {
    if (!filtered.length) return;
    if (!selected || !filtered.some((s) => s.id === selected)) {
      setSelected(filtered[0].id);
    }
  }, [filtered, selected]);

  if (error) return <p style={{ color: "var(--color-email)" }}>✗ {error}</p>;

  return (
    <div className="sessions">
      <aside className="sess-list card">
        <input
          className="learn-search"
          placeholder="Search sessions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="sess-filter" role="group" aria-label="Filter sessions by kind">
          {CAT_FILTERS.map((f) => (
            <button
              key={f.id}
              className={`sess-filter-btn${cat === f.id ? " active" : ""}`}
              aria-pressed={cat === f.id}
              onClick={() => setCat(f.id)}
            >
              {f.label}
              {f.id !== "all" && (
                <span className="sess-filter-count"> {counts[f.id]}</span>
              )}
            </button>
          ))}
        </div>
        {sessions === null && <p className="muted" style={{ padding: "0.5rem" }}>…</p>}
        {sessions !== null && filtered.length === 0 && (
          <p className="muted" style={{ padding: "0.5rem" }}>No matching sessions.</p>
        )}
        {filtered.map((s) => (
          <button
            key={s.id}
            className={`sess-item${selected === s.id ? " active" : ""}`}
            onClick={() => setSelected(s.id)}
          >
            <span className="sess-item-top">
              <span className="sess-item-title">{s.title}</span>
              {s.running && <span className="sess-dot" title="running now" />}
            </span>
            <span className="sess-item-meta">
              {s.project} · {ago(s.endedAt)}
            </span>
          </button>
        ))}
      </aside>

      {selected ? (
        <Detail id={selected} onOpenLearning={onOpenLearning} />
      ) : (
        <p className="muted">Select a session.</p>
      )}
    </div>
  );
}
