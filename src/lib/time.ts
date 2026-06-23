// Human, calm relative-time phrasing for the greeting line.
export function relativeToFirstMeeting(iso: string | null, now: Date): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const diffMs = t - now.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < -1) return "first meeting was earlier today";
  if (mins <= 1) return "first meeting is starting now";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const rel =
    h > 0 ? `${h}h ${m}m` : `${m}m`;
  const clock = new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `first meeting in ${rel} (${clock})`;
}

export function prettyDate(date: string): string {
  // date is YYYY-MM-DD (local). Render without TZ drift.
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// SQLite datetime('now') is "YYYY-MM-DD HH:MM:SS" in UTC.
export function fromSqlite(ts: string): Date {
  return new Date(ts.replace(" ", "T") + "Z");
}

// "just now" / "5m ago" / "2h ago" / "3d ago" from a SQLite UTC timestamp.
export function agoFromSqlite(ts: string, now = new Date()): string {
  const d = fromSqlite(ts);
  if (isNaN(d.getTime())) return "";
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
