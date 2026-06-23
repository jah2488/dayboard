// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../shared/types";
import { TasksPanel } from "./TasksPanel";

const TODAY = "2026-06-08";

function task(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "A task",
    notes: null,
    status: "backlog",
    isCurrent: false,
    sourceSectionId: null,
    sourceDate: null,
    dueDate: null,
    createdAt: `${TODAY} 09:00:00`,
    completedAt: null,
    ...over,
  };
}

function renderPanel(over: Partial<Parameters<typeof TasksPanel>[0]> = {}) {
  const handlers = {
    onAdd: vi.fn(),
    onComplete: vi.fn(),
    onReopen: vi.fn(),
    onCurrent: vi.fn(),
    onRemove: vi.fn(),
    onSetDue: vi.fn(),
  };
  render(
    <TasksPanel backlog={[]} doneToday={[]} today={TODAY} {...handlers} {...over} />,
  );
  return handlers;
}

describe("TasksPanel", () => {
  it("shows an empty backlog message and the count", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "To do (0)" })).toBeInTheDocument();
    expect(screen.getByText("Nothing queued.")).toBeInTheDocument();
  });

  it("adds a task via the Add button, trimming whitespace, and clears the input", async () => {
    const { onAdd } = renderPanel();
    const input = screen.getByPlaceholderText("Add a task…");
    await userEvent.type(input, "  new task  ");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("new task");
    expect(input).toHaveValue("");
  });

  it("adds a task on Enter and ignores blank input", async () => {
    const { onAdd } = renderPanel();
    const input = screen.getByPlaceholderText("Add a task…");
    await userEvent.type(input, "{Enter}"); // blank -> ignored
    expect(onAdd).not.toHaveBeenCalled();
    await userEvent.type(input, "real{Enter}");
    expect(onAdd).toHaveBeenCalledWith("real");
  });

  it("completes a backlog task and pins it via the star", async () => {
    const { onComplete, onCurrent } = renderPanel({ backlog: [task({ id: 7 })] });
    await userEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await userEvent.click(screen.getByTitle("Make current"));
    expect(onComplete).toHaveBeenCalledWith(7);
    expect(onCurrent).toHaveBeenCalledWith(7);
  });

  it("reopens a done task from the Done-today section", async () => {
    const { onReopen } = renderPanel({
      doneToday: [task({ id: 8, status: "done", completedAt: `${TODAY} 10:00:00` })],
    });
    expect(screen.getByRole("heading", { name: "Done today (1)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark not done" }));
    expect(onReopen).toHaveBeenCalledWith(8);
  });

  it("marks a star/current control absent for the pinned task itself", () => {
    renderPanel({ backlog: [task({ isCurrent: true })] });
    expect(screen.queryByTitle("Make current")).not.toBeInTheDocument();
  });

  it("shows a stale age badge for tasks open 3+ days", () => {
    renderPanel({ backlog: [task({ createdAt: "2026-06-01 09:00:00" })] });
    expect(screen.getByText("7d")).toBeInTheDocument();
  });

  it("sets a due date through the date picker", async () => {
    const { onSetDue } = renderPanel({ backlog: [task({ id: 4 })] });
    await userEvent.click(screen.getByTitle("Set due date"));
    const picker = document.querySelector<HTMLInputElement>("input.due-input")!;
    await userEvent.type(picker, "2026-06-12");
    expect(onSetDue).toHaveBeenCalledWith(4, "2026-06-12");
  });

  it("renders an overdue due chip with a warning marker", () => {
    renderPanel({ backlog: [task({ id: 5, dueDate: "2026-06-01" })] });
    const chip = screen.getByTitle("Change due date");
    expect(within(chip).getByText(/⚠/)).toBeInTheDocument();
  });
});
