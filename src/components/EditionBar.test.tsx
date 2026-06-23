// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Edition } from "../../shared/types";
import { EditionBar } from "./EditionBar";

function edition(over: Partial<Edition> = {}): Edition {
  return {
    id: 1,
    date: "2026-06-08",
    label: "Morning",
    trigger: "morning",
    createdAt: "2026-06-08 12:00:00",
    issues: [],
    ...over,
  };
}

const base = {
  editions: [edition()],
  selectedId: 1,
  onSelect: () => {},
  onSweep: () => {},
  sweeping: false,
  canSweep: true,
};

describe("EditionBar", () => {
  it("selects an edition chip", async () => {
    const onSelect = vi.fn();
    render(
      <EditionBar
        {...base}
        editions={[edition({ id: 1, label: "Morning" }), edition({ id: 2, label: "Reset" })]}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: /Reset/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("runs a sweep when idle", async () => {
    const onSweep = vi.fn();
    render(<EditionBar {...base} onSweep={onSweep} />);
    await userEvent.click(screen.getByRole("button", { name: "↻ New sweep" }));
    expect(onSweep).toHaveBeenCalled();
  });

  it("shows a disabled sweeping state while a sweep runs", () => {
    render(<EditionBar {...base} sweeping />);
    const btn = screen.getByRole("button", { name: "… Sweeping" });
    expect(btn).toBeDisabled();
  });

  it("hides the sweep button when sweeping isn't allowed", () => {
    render(<EditionBar {...base} canSweep={false} />);
    expect(screen.queryByRole("button", { name: /sweep/i })).not.toBeInTheDocument();
  });
});
