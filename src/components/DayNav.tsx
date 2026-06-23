import { addDays, todayLocal } from "../lib/time";

export function DayNav({
  date,
  onChange,
}: {
  date: string;
  onChange: (date: string) => void;
}) {
  const today = todayLocal();
  return (
    <nav className="daynav" aria-label="Day navigation">
      <button
        className="btn"
        onClick={() => onChange(addDays(date, -1))}
        aria-label="Previous day"
      >
        ← Prev
      </button>
      <input
        className="btn"
        type="date"
        value={date}
        max={today}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
      <button
        className="btn"
        onClick={() => onChange(addDays(date, 1))}
        disabled={date >= today}
        aria-label="Next day"
      >
        Next →
      </button>
      <span className="spacer" />
      {date !== today && (
        <button className="btn btn-primary" onClick={() => onChange(today)}>
          Today
        </button>
      )}
    </nav>
  );
}
