import type { Insights, Task } from "../../shared/types";
import { shortDate } from "../lib/time";
import { MdInline } from "./Md";

function TaskLine({
  task,
  onComplete,
  onCurrent,
  badge,
}: {
  task: Task;
  onComplete: (id: number) => void;
  onCurrent: (id: number) => void;
  badge?: string;
}) {
  return (
    <div className="trend-task">
      <button
        className="check"
        aria-label="Mark done"
        onClick={() => onComplete(task.id)}
      />
      <span className="tt">
        <MdInline>{task.title}</MdInline>
      </span>
      {badge && <span className="trend-badge">{badge}</span>}
      <button
        className="btn btn-ghost"
        title="Make current"
        onClick={() => onCurrent(task.id)}
      >
        ★
      </button>
    </div>
  );
}

export function TrendsView({
  insights,
  onComplete,
  onCurrent,
}: {
  insights: Insights | null;
  onComplete: (id: number) => void;
  onCurrent: (id: number) => void;
}) {
  if (!insights) return <p className="muted">…</p>;
  const { upcoming, stale, weekly, totals } = insights;
  const maxBar = Math.max(1, ...weekly.map((w) => Math.max(w.created, w.completed)));
  const weekday = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString([], { weekday: "short" })[0];

  return (
    <div className="trends">
      <h1 style={{ fontSize: "1.6rem", margin: "0 0 1rem" }}>Trends</h1>

      <div className="trend-totals">
        <div className="stat">
          <span className="n">{totals.open}</span>
          <span className="l">open tasks</span>
        </div>
        <div className="stat">
          <span className="n">{totals.completedThisWeek}</span>
          <span className="l">done this week</span>
        </div>
        <div className="stat">
          <span className="n">{upcoming.overdue.length}</span>
          <span className="l">overdue</span>
        </div>
      </div>

      <section className="card trend-card">
        <h2>Completed — last 7 days</h2>
        <div className="bars">
          {weekly.map((w) => (
            <div className="bar-col" key={w.date} title={`${w.date}: ${w.completed} done, ${w.created} added`}>
              <div className="bar-track">
                <div
                  className="bar created"
                  style={{ height: `${(w.created / maxBar) * 100}%` }}
                />
                <div
                  className="bar completed"
                  style={{ height: `${(w.completed / maxBar) * 100}%` }}
                />
              </div>
              <span className="bar-n">{w.completed}</span>
              <span className="bar-d">{weekday(w.date)}</span>
            </div>
          ))}
        </div>
        <p className="muted legend">
          <span className="swatch completed" /> completed&nbsp;&nbsp;
          <span className="swatch created" /> added
        </p>
      </section>

      <section className="card trend-card">
        <h2>⚠ Upcoming</h2>
        {upcoming.overdue.length === 0 &&
          upcoming.dueToday.length === 0 &&
          upcoming.dueSoon.length === 0 && (
            <p className="muted">Nothing due in the next 3 days.</p>
          )}
        {upcoming.overdue.map((t) => (
          <TaskLine key={t.id} task={t} onComplete={onComplete} onCurrent={onCurrent} badge={`overdue · ${shortDate(t.dueDate!)}`} />
        ))}
        {upcoming.dueToday.map((t) => (
          <TaskLine key={t.id} task={t} onComplete={onComplete} onCurrent={onCurrent} badge="due today" />
        ))}
        {upcoming.dueSoon.map((t) => (
          <TaskLine key={t.id} task={t} onComplete={onComplete} onCurrent={onCurrent} badge={`due ${shortDate(t.dueDate!)}`} />
        ))}
      </section>

      <section className="card trend-card">
        <h2>🕸 Lingering ({stale.length})</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Open 3+ days — knock one out or drop it.
        </p>
        {stale.length === 0 && <p className="muted">Nothing stuck. Nice.</p>}
        {stale.map(({ task, ageDays }) => (
          <TaskLine
            key={task.id}
            task={task}
            onComplete={onComplete}
            onCurrent={onCurrent}
            badge={`${ageDays}d`}
          />
        ))}
      </section>
    </div>
  );
}
