import type { RoutineStatus, SweepJob } from "../../shared/types";

const STEP_ICON: Record<RoutineStatus, string> = {
  done: "✓",
  failed: "✗",
  running: "↻",
  pending: "•",
};

// Live banner shown while a sweep runs for the viewed day. Lists each routine
// and its state so the board never looks mysteriously empty mid-sweep.
export function SweepProgress({ job }: { job: SweepJob }) {
  return (
    <div className="sweep-progress" role="status" aria-live="polite">
      <span className="sweep-spinner" aria-hidden>
        ↻
      </span>
      <span className="sweep-progress-title">Sweeping the board…</span>
      <ul className="sweep-steps">
        {job.routines.map((r) => (
          <li key={r.name} className={`sweep-step ${r.status}`}>
            <span className="sweep-step-icon" aria-hidden>
              {STEP_ICON[r.status]}
            </span>
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
