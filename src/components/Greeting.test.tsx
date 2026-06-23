// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Day } from "../../shared/types";
import { Greeting } from "./Greeting";

function day(over: Partial<Day> = {}): Day {
  return {
    date: "2026-06-08",
    greeting: null,
    firstMeetingAt: null,
    meetingCount: null,
    createdAt: "2026-06-08 09:00:00",
    ...over,
  };
}

describe("Greeting", () => {
  it("falls back to a generic greeting and 'no meetings' when day is null", () => {
    render(<Greeting date="2026-06-08" day={null} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Good morning.");
    expect(screen.getByText(/No meetings today/)).toBeInTheDocument();
  });

  it("personalizes the fallback greeting when a name is configured", () => {
    render(<Greeting date="2026-06-08" day={null} name="Ada" />);
    expect(screen.getByRole("heading")).toHaveTextContent("Good morning, Ada.");
  });

  it("uses the stored greeting and pluralizes the meeting count", () => {
    render(<Greeting date="2026-06-08" day={day({ greeting: "Hey JH", meetingCount: 3 })} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Hey JH");
    expect(screen.getByText(/3 meetings today/)).toBeInTheDocument();
  });

  it("singularizes a single meeting", () => {
    render(<Greeting date="2026-06-08" day={day({ meetingCount: 1 })} />);
    expect(screen.getByText(/1 meeting today/)).toBeInTheDocument();
  });
});
