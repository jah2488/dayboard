import { useEffect, useState } from "react";
import type { Day } from "../../shared/types";
import { prettyDate, relativeToFirstMeeting } from "../lib/time";

export function Greeting({
  date,
  day,
  name,
}: {
  date: string;
  day: Day | null;
  name?: string;
}) {
  // Tick once a minute so the relative time stays live.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const count = day?.meetingCount ?? 0;
  const rel = relativeToFirstMeeting(day?.firstMeetingAt ?? null, now);

  const fallback = name ? `Good morning, ${name}.` : "Good morning.";
  return (
    <header className="greeting">
      <h1>{day?.greeting ?? fallback}</h1>
      <p className="date">{prettyDate(date)}</p>
      <span className="meeting">
        {count === 0 ? (
          <>🎉 No meetings today</>
        ) : (
          <>
            📅 {rel ? <strong>{rel}</strong> : null}
            {rel ? " · " : null}
            {count} {count === 1 ? "meeting" : "meetings"} today
          </>
        )}
      </span>
    </header>
  );
}
