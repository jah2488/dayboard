import { useState } from "react";
import type { Task } from "../../shared/types";
import { daysBetween, shortDate } from "../lib/time";
import { MdInline } from "./Md";

function DueChip({
  task,
  today,
  onSetDue,
}: {
  task: Task;
  today: string;
  onSetDue: (id: number, due: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        className="due-input"
        type="date"
        autoFocus
        defaultValue={task.dueDate ?? ""}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          onSetDue(task.id, e.target.value || null);
          setEditing(false);
        }}
      />
    );
  }
  if (!task.dueDate)
    return (
      <button
        className="btn btn-ghost due-add"
        title="Set due date"
        onClick={() => setEditing(true)}
      >
        📅
      </button>
    );
  const cls =
    task.dueDate < today ? "due overdue" : task.dueDate === today ? "due today" : "due";
  return (
    <button
      className={cls}
      title="Change due date"
      onClick={() => setEditing(true)}
    >
      {task.dueDate < today ? "⚠ " : ""}
      {shortDate(task.dueDate)}
    </button>
  );
}

function TaskRow({
  task,
  today,
  onComplete,
  onReopen,
  onCurrent,
  onRemove,
  onSetDue,
}: {
  task: Task;
  today: string;
  onComplete: (id: number) => void;
  onReopen: (id: number) => void;
  onCurrent: (id: number) => void;
  onRemove: (id: number) => void;
  onSetDue: (id: number, due: string | null) => void;
}) {
  const done = task.status === "done";
  const age = daysBetween(task.createdAt.slice(0, 10), today);
  return (
    <div className={`task-row${done ? " done" : ""}`}>
      <button
        className={`check${done ? " on" : ""}`}
        aria-label={done ? "Mark not done" : "Mark done"}
        onClick={() => (done ? onReopen(task.id) : onComplete(task.id))}
      >
        {done ? "✓" : ""}
      </button>
      <span className="t-title">
        <MdInline>{task.title}</MdInline>
        {!done && age >= 3 && (
          <span className="stale" title={`Open ${age} days`}>
            {age}d
          </span>
        )}
      </span>
      {!done && <DueChip task={task} today={today} onSetDue={onSetDue} />}
      {!done && !task.isCurrent && (
        <button
          className="btn btn-ghost"
          title="Make current"
          onClick={() => onCurrent(task.id)}
        >
          ★
        </button>
      )}
      {!done && (
        <button
          className="btn btn-ghost"
          title="Delete"
          onClick={() => onRemove(task.id)}
        >
          🗑
        </button>
      )}
    </div>
  );
}

export function TasksPanel({
  backlog,
  doneToday,
  today,
  onAdd,
  onComplete,
  onReopen,
  onCurrent,
  onRemove,
  onSetDue,
}: {
  backlog: Task[];
  doneToday: Task[];
  today: string;
  onAdd: (title: string) => void;
  onComplete: (id: number) => void;
  onReopen: (id: number) => void;
  onCurrent: (id: number) => void;
  onRemove: (id: number) => void;
  onSetDue: (id: number, due: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
  };

  return (
    <aside className="col-stack">
      <div className="card panel" style={{ padding: "1rem" }}>
        <h2>To do ({backlog.length})</h2>
        {backlog.length === 0 && <p className="muted">Nothing queued.</p>}
        {backlog.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            today={today}
            onComplete={onComplete}
            onReopen={onReopen}
            onCurrent={onCurrent}
            onRemove={onRemove}
            onSetDue={onSetDue}
          />
        ))}
        <div className="add-task">
          <input
            value={draft}
            placeholder="Add a task…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button className="btn btn-primary" onClick={submit}>
            Add
          </button>
        </div>
      </div>

      {doneToday.length > 0 && (
        <div className="card panel" style={{ padding: "1rem" }}>
          <h2>Done today ({doneToday.length})</h2>
          {doneToday.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              today={today}
              onComplete={onComplete}
              onReopen={onReopen}
              onCurrent={onCurrent}
              onRemove={onRemove}
              onSetDue={onSetDue}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
