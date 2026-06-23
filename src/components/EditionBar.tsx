import type { Edition } from "../../shared/types";
import { agoFromSqlite, fromSqlite } from "../lib/time";

function editionTime(e: Edition): string {
  const d = fromSqlite(e.createdAt);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function EditionBar({
  editions,
  selectedId,
  onSelect,
  onSweep,
  sweeping,
  canSweep,
}: {
  editions: Edition[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onSweep: () => void;
  sweeping: boolean;
  canSweep: boolean;
}) {
  const selected = editions.find((e) => e.id === selectedId) ?? null;
  return (
    <div className="editionbar">
      {editions.length > 1 || editions.length === 1 ? (
        <div className="ed-chips" role="tablist" aria-label="Editions">
          {editions.map((e) => (
            <button
              key={e.id}
              role="tab"
              aria-selected={e.id === selectedId}
              className={`ed-chip${e.id === selectedId ? " active" : ""}`}
              onClick={() => onSelect(e.id)}
              title={`${e.label} · ${editionTime(e)}`}
            >
              {e.label}
              <span className="ed-time">{editionTime(e)}</span>
            </button>
          ))}
        </div>
      ) : (
        <span className="muted">No sweep yet for this day.</span>
      )}
      {selected && (
        <span className="swept muted" title={fromSqlite(selected.createdAt).toLocaleString()}>
          swept {agoFromSqlite(selected.createdAt)}
        </span>
      )}
      <span className="spacer" />
      {canSweep && (
        <button
          className="btn btn-primary"
          onClick={onSweep}
          disabled={sweeping}
          title="Run a fresh sweep — creates a new page, keeps this one"
        >
          {sweeping ? "… Sweeping" : "↻ New sweep"}
        </button>
      )}
    </div>
  );
}
