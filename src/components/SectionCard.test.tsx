// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Section } from "../../shared/types";
import { SectionCard } from "./SectionCard";

function section(over: Partial<Section> = {}): Section {
  return {
    id: 7,
    editionId: 1,
    date: "2026-06-08",
    source: "slack",
    title: "Slack — needs a reply",
    bodyMd: "- ping from Alex\n- review from Sam",
    sort: 0,
    status: "active",
    createdAt: "2026-06-08 12:00:00",
    dismissedAt: null,
    ...over,
  };
}

function renderCard(over: Partial<Section> = {}) {
  const onDismiss = vi.fn();
  const onAddTask = vi.fn();
  const { container } = render(
    <SectionCard
      section={section(over)}
      onDismiss={onDismiss}
      onAddTask={onAddTask}
    />,
  );
  return { container, onDismiss, onAddTask };
}

describe("SectionCard", () => {
  it("exposes a scroll anchor id derived from the section id", () => {
    const { container } = renderCard({ id: 42 });
    expect(container.querySelector("#section-42")).toBeInTheDocument();
  });

  it("shows the title and source label", () => {
    renderCard();
    expect(screen.getByText("Slack — needs a reply")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
  });

  it("turns a bullet into a current task via '+ Now'", async () => {
    const { onAddTask } = renderCard();
    await userEvent.click(screen.getAllByTitle("Make this my current task")[0]);
    expect(onAddTask).toHaveBeenCalledWith("ping from Alex", 7, true);
  });

  it("turns a bullet into a backlog task via '+ Backlog'", async () => {
    const { onAddTask } = renderCard();
    await userEvent.click(screen.getAllByTitle("Add to backlog")[1]);
    expect(onAddTask).toHaveBeenCalledWith("review from Sam", 7, false);
  });

  it("dismisses the section", async () => {
    const { onDismiss } = renderCard({ id: 9 });
    await userEvent.click(screen.getByRole("button", { name: /section done/i }));
    expect(onDismiss).toHaveBeenCalledWith(9);
  });

  it("renders non-bullet prose without task actions", () => {
    renderCard({ bodyMd: "Nothing notable." });
    expect(screen.getByText("Nothing notable.")).toBeInTheDocument();
    expect(screen.queryByTitle("Add to backlog")).not.toBeInTheDocument();
  });
});
