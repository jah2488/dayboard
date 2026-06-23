import { describe, expect, it } from "vitest";
import {
  addDays,
  agoFromSqlite,
  daysBetween,
  fromSqlite,
  prettyDate,
  relativeToFirstMeeting,
  shortDate,
  todayLocal,
} from "./time";

describe("todayLocal", () => {
  it("is a YYYY-MM-DD string with a zero day offset", () => {
    const t = todayLocal();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(addDays(t, 0)).toBe(t);
  });
});

describe("addDays", () => {
  it("moves forward and backward across month boundaries", () => {
    expect(addDays("2026-06-08", 1)).toBe("2026-06-09");
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("daysBetween", () => {
  it("counts whole days between two local dates", () => {
    expect(daysBetween("2026-06-01", "2026-06-08")).toBe(7);
    expect(daysBetween("2026-06-08", "2026-06-01")).toBe(-7);
    expect(daysBetween("2026-06-08", "2026-06-08")).toBe(0);
  });
});

describe("fromSqlite", () => {
  it("parses a UTC sqlite timestamp", () => {
    expect(fromSqlite("2026-06-08 15:39:35").toISOString()).toBe(
      "2026-06-08T15:39:35.000Z",
    );
  });
  it("yields an invalid date for garbage", () => {
    expect(isNaN(fromSqlite("not-a-date").getTime())).toBe(true);
  });
});

describe("agoFromSqlite", () => {
  const now = new Date("2026-06-08T12:00:00Z");
  it.each([
    ["2026-06-08 11:59:40", "just now"], // <1 min
    ["2026-06-08 11:55:00", "5m ago"],
    ["2026-06-08 10:00:00", "2h ago"],
    ["2026-06-05 12:00:00", "3d ago"],
  ])("%s -> %s", (ts, expected) => {
    expect(agoFromSqlite(ts, now)).toBe(expected);
  });
  it("returns empty string for an invalid timestamp", () => {
    expect(agoFromSqlite("nope", now)).toBe("");
  });
});

describe("relativeToFirstMeeting", () => {
  const now = new Date("2026-06-08T12:00:00Z");
  it("is empty when there is no meeting", () => {
    expect(relativeToFirstMeeting(null, now)).toBe("");
  });
  it("reports a past meeting", () => {
    expect(relativeToFirstMeeting("2026-06-08T11:00:00Z", now)).toBe(
      "first meeting was earlier today",
    );
  });
  it("reports a meeting starting now", () => {
    expect(relativeToFirstMeeting("2026-06-08T12:00:30Z", now)).toBe(
      "first meeting is starting now",
    );
  });
  it("reports hours and minutes out", () => {
    expect(relativeToFirstMeeting("2026-06-08T13:30:00Z", now)).toContain(
      "first meeting in 1h 30m",
    );
  });
  it("reports minutes-only when under an hour", () => {
    expect(relativeToFirstMeeting("2026-06-08T12:20:00Z", now)).toContain(
      "first meeting in 20m",
    );
  });
});

describe("locale formatters", () => {
  it("prettyDate renders weekday/month/day without throwing", () => {
    expect(prettyDate("2026-06-08")).toBeTruthy();
  });
  it("shortDate renders month/day without throwing", () => {
    expect(shortDate("2026-06-08")).toBeTruthy();
  });
});
