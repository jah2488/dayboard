import type { Section } from "../../shared/types";
import { SOURCE_META } from "../sources";
import { sectionAnchorId } from "../lib/sectionAnchor";

export function ClearedTray({
  sections,
  onReopen,
}: {
  sections: Section[];
  onReopen: (id: number) => void;
}) {
  if (sections.length === 0) return null;
  return (
    <details id="cleared-tray" className="tray card" style={{ padding: "0.5rem 1rem" }}>
      <summary>Cleared ({sections.length})</summary>
      {sections.map((s) => {
        const meta = SOURCE_META[s.source];
        return (
          <div className="task-row" id={sectionAnchorId(s.id)} key={s.id}>
            <span aria-hidden>{meta.icon}</span>
            <span className="t-title muted">{s.title}</span>
            <button className="btn btn-ghost" onClick={() => onReopen(s.id)}>
              Restore
            </button>
          </div>
        );
      })}
    </details>
  );
}
