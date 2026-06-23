import type { SweepIssue } from "../../shared/types";

// Top-of-page alert when the last sweep had connector/fetch problems.
export function AlertPanel({ issues }: { issues: SweepIssue[] }) {
  if (!issues || issues.length === 0) return null;
  return (
    <section className="alertpanel" role="alert">
      <div className="alert-head">
        <span aria-hidden>⚠</span>
        <strong>
          {issues.length} {issues.length === 1 ? "issue" : "issues"} during the last sweep
        </strong>
      </div>
      <ul>
        {issues.map((it, i) => (
          <li key={i}>
            <span className="alert-source">{it.source}</span>
            <span className="alert-msg">{it.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
