// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Insights, Task } from "../../shared/types";
import { HeadsUp } from "./HeadsUp";

const t = (id: number): Task => ({
  id,
  title: `t${id}`,
  notes: null,
  status: "backlog",
  isCurrent: false,
  sourceSectionId: null,
  sourceDate: null,
  dueDate: null,
  createdAt: "2026-06-08 09:00:00",
  completedAt: null,
});

function insights(over: Partial<Insights["upcoming"]> = {}, stale: Insights["stale"] = []): Insights {
  return {
    date: "2026-06-08",
    upcoming: { overdue: [], dueToday: [], dueSoon: [], ...over },
    stale,
    weekly: [],
    totals: { open: 0, completedThisWeek: 0 },
  };
}

describe("HeadsUp", () => {
  it("renders nothing without insights", () => {
    const { container } = render(<HeadsUp insights={null} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is nothing pressing", () => {
    const { container } = render(<HeadsUp insights={insights()} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarizes overdue, due-today, and lingering counts and links to trends", async () => {
    const onOpen = vi.fn();
    render(
      <HeadsUp
        insights={insights({ overdue: [t(1)], dueToday: [t(2), t(3)] }, [{ task: t(4), ageDays: 5 }])}
        onOpen={onOpen}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveTextContent("1 overdue · 2 due today · 1 lingering");
    expect(btn).toHaveClass("urgent"); // overdue present
    await userEvent.click(btn);
    expect(onOpen).toHaveBeenCalled();
  });
});
