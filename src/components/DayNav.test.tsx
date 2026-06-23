// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { todayLocal } from "../lib/time";
import { DayNav } from "./DayNav";

describe("DayNav", () => {
  it("steps to the previous and next day", async () => {
    const onChange = vi.fn();
    render(<DayNav date="2026-06-08" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(onChange).toHaveBeenCalledWith("2026-06-07");
  });

  it("disables Next and hides the Today shortcut when already on today", () => {
    render(<DayNav date={todayLocal()} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
  });

  it("offers a Today shortcut when viewing a past day", async () => {
    const onChange = vi.fn();
    render(<DayNav date="2020-01-01" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onChange).toHaveBeenCalledWith(todayLocal());
  });
});
