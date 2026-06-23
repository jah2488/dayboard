// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Section } from "../../shared/types";
import { ClearedTray } from "./ClearedTray";

function section(over: Partial<Section> = {}): Section {
  return {
    id: 3,
    editionId: 1,
    date: "2026-06-08",
    source: "slack",
    title: "Slack — needs a reply",
    bodyMd: "",
    sort: 0,
    status: "done",
    createdAt: "2026-06-08 12:00:00",
    dismissedAt: "2026-06-08 12:30:00",
    ...over,
  };
}

describe("ClearedTray", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<ClearedTray sections={[]} onReopen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts cleared sections and gives each a scroll anchor for the sidebar", () => {
    const { container } = render(
      <ClearedTray sections={[section({ id: 11 })]} onReopen={() => {}} />,
    );
    expect(screen.getByText("Cleared (1)")).toBeInTheDocument();
    expect(container.querySelector("#cleared-tray")).toBeInTheDocument();
    expect(container.querySelector("#section-11")).toBeInTheDocument();
  });

  it("restores a section", async () => {
    const onReopen = vi.fn();
    render(<ClearedTray sections={[section({ id: 9 })]} onReopen={onReopen} />);
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onReopen).toHaveBeenCalledWith(9);
  });
});
