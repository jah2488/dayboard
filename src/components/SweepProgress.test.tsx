// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RoutineStatus, SweepJob } from "../../shared/types";
import { SweepProgress } from "./SweepProgress";

function job(statuses: Record<string, RoutineStatus>): SweepJob {
  return {
    id: "j1",
    status: "running",
    date: "2026-06-08",
    label: "Reset",
    editionId: 1,
    error: null,
    routines: Object.entries(statuses).map(([name, status]) => ({
      name,
      label: name,
      status,
    })),
  };
}

describe("SweepProgress", () => {
  it("announces progress politely for screen readers", () => {
    render(<SweepProgress job={job({ "Morning brief": "running" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sweeping the board…");
  });

  it("renders one step per routine with the status as a class", () => {
    render(
      <SweepProgress
        job={job({ "Morning brief": "done", "Partner tracker": "running" })}
      />,
    );
    const done = screen.getByText("Morning brief").closest("li");
    const running = screen.getByText("Partner tracker").closest("li");
    expect(done).toHaveClass("sweep-step", "done");
    expect(running).toHaveClass("sweep-step", "running");
  });

  it.each([
    ["done", "✓"],
    ["failed", "✗"],
    ["running", "↻"],
    ["pending", "•"],
  ] as Array<[RoutineStatus, string]>)(
    "shows the %s icon",
    (status, icon) => {
      render(<SweepProgress job={job({ Step: status })} />);
      const li = screen.getByText("Step").closest("li")!;
      expect(within(li).getByText(icon)).toBeInTheDocument();
    },
  );
});
