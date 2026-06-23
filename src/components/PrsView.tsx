import { useEffect, useMemo, useState } from "react";
import type { OpenPr } from "../../shared/types";
import { api } from "../api";

type SortKey = "repo" | "number" | "stateLabel" | "ageDays" | "reviewChannel" | "tickets" | "note";

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "repo", label: "Repo" },
  { key: "number", label: "PR" },
  { key: "stateLabel", label: "State" },
  { key: "ageDays", label: "Age", numeric: true },
  { key: "reviewChannel", label: "Review channel" },
  { key: "tickets", label: "Ticket(s)" },
  { key: "note", label: "Notes — why open beyond review" },
];

function sortValue(pr: OpenPr, key: SortKey): string | number {
  if (key === "ageDays") return pr.ageDays;
  if (key === "number") return `${pr.repo}#${String(pr.number).padStart(7, "0")}`;
  if (key === "tickets") return pr.tickets.join(",").toLowerCase();
  const v = pr[key];
  return typeof v === "string" ? v.toLowerCase() : String(v ?? "");
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ageClass(days: number): string {
  if (days >= 30) return " old";
  if (days >= 10) return " mid";
  return "";
}

export function PrsView() {
  const [prs, setPrs] = useState<OpenPr[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "ageDays",
    dir: -1, // stalest first
  });

  useEffect(() => {
    api.listOpenPrs().then(setPrs).catch((e) => setError(String(e)));
  }, []);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: key === "ageDays" ? -1 : 1 },
    );

  const refresh = () => {
    setRefreshing(true);
    setError(null);
    api
      .refreshOpenPrs()
      .then(setPrs)
      .catch((e) => setError(String(e)))
      .finally(() => setRefreshing(false));
  };

  const sorted = useMemo(() => {
    if (!prs) return [];
    const rows = [...prs];
    rows.sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      return x < y ? -sort.dir : x > y ? sort.dir : 0;
    });
    return rows;
  }, [prs, sort]);

  if (error) return <p style={{ color: "var(--color-email)" }}>✗ {error}</p>;
  if (!prs) return <p className="muted">…</p>;

  const ready = prs.filter((p) => !p.isDraft).length;
  const draft = prs.length - ready;
  const fetchedAt = prs[0]?.fetchedAt;

  return (
    <div className="prs">
      <header className="prs-head">
        <div>
          <h2 className="prs-title">Open PRs</h2>
          <p className="muted prs-sub">
            {prs.length} open · {ready} ready · {draft} draft
            {fetchedAt && ` · updated ${ago(fetchedAt)}`}
            {" · authored by me across the org"}
          </p>
        </div>
        <button className="btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "↻ Refresh now"}
        </button>
      </header>

      {prs.length === 0 ? (
        <p className="muted">No open PRs. 🎉</p>
      ) : (
        <table className="prs-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`prs-th${sort.key === col.key ? " sorted" : ""}${col.numeric ? " num" : ""}`}
                  onClick={() => onSort(col.key)}
                >
                  {col.label}
                  <span className="prs-arr">
                    {sort.key === col.key ? (sort.dir === 1 ? "↑" : "↓") : "↕"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((pr) => (
              <tr key={pr.url} className={pr.isDraft ? "" : "ready"}>
                <td>{pr.repo}</td>
                <td className="prs-prcell">
                  <a href={pr.url} target="_blank" rel="noreferrer">
                    #{pr.number}
                  </a>{" "}
                  <span className="prs-pr-title">{pr.title}</span>
                </td>
                <td>
                  <span className={`prs-pill ${pr.isDraft ? "draft" : "ready"}`}>
                    {pr.stateLabel}
                  </span>
                  {pr.flags.map((f) => (
                    <span
                      key={f}
                      className={`prs-flag${/conflict|failing|changes/.test(f) ? " err" : /behind|blocked|CI running/.test(f) ? " warn" : ""}`}
                    >
                      {f}
                    </span>
                  ))}
                </td>
                <td className={`prs-age${ageClass(pr.ageDays)}`}>
                  {pr.ageDays === 0 ? "today" : `${pr.ageDays}d`}
                </td>
                <td className="prs-chan">
                  {pr.reviewChannel}
                  {!pr.channelVerified && <span className="prs-verify"> verify</span>}
                </td>
                <td className="prs-tk">{pr.tickets.join(", ") || "—"}</td>
                <td className="prs-note">{pr.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
