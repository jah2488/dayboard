import type { Task } from "../../shared/types";
import { MdInline } from "./Md";

export function CurrentTask({
  task,
  onComplete,
  onUnpin,
}: {
  task: Task | null;
  onComplete: (id: number) => void;
  onUnpin: (id: number) => void;
}) {
  if (!task) {
    return (
      <section className="current empty">
        <p className="label">Right now</p>
        <p style={{ margin: 0 }}>
          Nothing pinned. Pick a task below, or turn a line into one.
        </p>
      </section>
    );
  }
  return (
    <section className="current" aria-label="Current task">
      <p className="label">Right now</p>
      <p className="ct-title">
        <MdInline>{task.title}</MdInline>
      </p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="btn btn-primary" onClick={() => onComplete(task.id)}>
          ✓ Done
        </button>
        <button className="btn btn-ghost" onClick={() => onUnpin(task.id)}>
          Unpin
        </button>
      </div>
    </section>
  );
}
