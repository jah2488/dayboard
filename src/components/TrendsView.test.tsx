// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Insights, Task } from "../../shared/types";
import { TrendsView } from "./TrendsView";

const t = (id: number, due?: string): Task => ({
  id,
  title: `task ${id}`,
  notes: null,
  status: "backlog",
  isCurrent: false,
  sourceSectionId: null,
  sourceDate: null,
  dueDate: due ?? null,
  createdAt: "2026-06-08 09:00:00",
  completedAt: null,
});

function insights(over: Partial<Insights> = {}): Insights {
  return {
    date: "2026-06-08",
    upcoming: { overdue: [], dueToday: [], dueSoon: [] },
    stale: [],
    weekly: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-06-0${i + 1}`,
      created: i,
      completed: i,
    })),
    totals: { open: 4, completedThisWeek: 9 },
    ...over,
  };
}

describe("TrendsView", () => {
  it("shows a loading dash before insights arrive", () => {
    render(<TrendsView insights={null} onComplete={() => {}} onCurrent={() => {}} />);
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("renders headline totals", () => {
    render(<TrendsView insights={insights()} onComplete={() => {}} onCurrent={() => {}} />);
    expect(screen.getByText("open tasks").previousSibling).toHaveTextContent("4");
    expect(screen.getByText("done this week").previousSibling).toHaveTextContent("9");
  });

  it("shows empty states for upcoming and lingering when there's nothing", () => {
    render(<TrendsView insights={insights()} onComplete={() => {}} onCurrent={() => {}} />);
    expect(screen.getByText("Nothing due in the next 3 days.")).toBeInTheDocument();
    expect(screen.getByText("Nothing stuck. Nice.")).toBeInTheDocument();
  });

  it("lists upcoming and lingering tasks and wires the row actions", async () => {
    const onComplete = vi.fn();
    const onCurrent = vi.fn();
    render(
      <TrendsView
        insights={insights({
          upcoming: { overdue: [t(1, "2026-06-01")], dueToday: [t(2, "2026-06-08")], dueSoon: [t(3, "2026-06-10")] },
          stale: [{ task: t(4), ageDays: 5 }],
        })}
        onComplete={onComplete}
        onCurrent={onCurrent}
      />,
    );
    expect(screen.getByText(/overdue ·/)).toBeInTheDocument();
    expect(screen.getByText("due today")).toBeInTheDocument();
    expect(screen.getByText("🕸 Lingering (1)")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "Mark done" })[0]);
    await userEvent.click(screen.getAllByTitle("Make current")[0]);
    expect(onComplete).toHaveBeenCalledWith(1);
    expect(onCurrent).toHaveBeenCalledWith(1);
  });
});
