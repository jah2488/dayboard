import type { Insights } from "../../shared/types";

// Compact, glanceable strip on Today — only appears when something needs eyes.
// Clicking jumps to the Trends tab for detail.
export function HeadsUp({
  insights,
  onOpen,
}: {
  insights: Insights | null;
  onOpen: () => void;
}) {
  if (!insights) return null;
  const { overdue, dueToday } = insights.upcoming;
  const staleCount = insights.stale.length;
  const bits: string[] = [];
  if (overdue.length) bits.push(`${overdue.length} overdue`);
  if (dueToday.length) bits.push(`${dueToday.length} due today`);
  if (staleCount) bits.push(`${staleCount} lingering`);
  if (bits.length === 0) return null;

  return (
    <button
      className={`headsup${overdue.length ? " urgent" : ""}`}
      onClick={onOpen}
    >
      <span aria-hidden>⚠</span>
      <span>{bits.join(" · ")}</span>
      <span className="headsup-go">Trends →</span>
    </button>
  );
}
