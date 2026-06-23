// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../shared/types";
import { CurrentTask } from "./CurrentTask";

const task: Task = {
  id: 5,
  title: "Ship the thing",
  notes: null,
  status: "backlog",
  isCurrent: true,
  sourceSectionId: null,
  sourceDate: null,
  dueDate: null,
  createdAt: "2026-06-08 09:00:00",
  completedAt: null,
};

describe("CurrentTask", () => {
  it("shows an empty-state prompt when nothing is pinned", () => {
    render(<CurrentTask task={null} onComplete={() => {}} onUnpin={() => {}} />);
    expect(screen.getByText(/Nothing pinned/)).toBeInTheDocument();
  });

  it("completes and unpins the pinned task", async () => {
    const onComplete = vi.fn();
    const onUnpin = vi.fn();
    render(<CurrentTask task={task} onComplete={onComplete} onUnpin={onUnpin} />);
    await userEvent.click(screen.getByRole("button", { name: "✓ Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Unpin" }));
    expect(onComplete).toHaveBeenCalledWith(5);
    expect(onUnpin).toHaveBeenCalledWith(5);
  });
});
