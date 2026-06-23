// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DayView, SweepJob } from "../shared/types";

const m = vi.hoisted(() => ({
  getDay: vi.fn(),
  getInsights: vi.fn(),
  startSweep: vi.fn(),
  dismissSection: vi.fn(),
  // App loads config on mount for tab visibility + greeting; null is fine (it
  // falls back to all tabs enabled and a generic greeting).
  getConfig: vi.fn(() => Promise.resolve(null)),
  // Default: already configured, so the dashboard (not onboarding) renders.
  getConfigStatus: vi.fn(() => Promise.resolve({ configured: true })),
  getConfigCheck: vi.fn(() => Promise.resolve({ ok: true, checks: [] })),
}));
vi.mock("./api", () => ({ api: m }));

import { App } from "./App";

const insights = {
  date: "2026-06-08",
  upcoming: { overdue: [], dueToday: [], dueSoon: [] },
  stale: [],
  weekly: [],
  totals: { open: 0, completedThisWeek: 0 },
};

function view(over: Partial<DayView> = {}): DayView {
  return {
    date: "2026-06-08",
    day: null,
    editions: [
      { id: 1, date: "2026-06-08", label: "Morning", trigger: "morning", createdAt: "2026-06-08 12:00:00", issues: [] },
    ],
    selectedEditionId: 1,
    activeSweep: null,
    sections: [],
    tasks: { current: null, backlog: [], doneToday: [] },
    ...over,
  };
}

function section(id: number, source = "slack", status = "active") {
  return {
    id, editionId: 1, date: "2026-06-08", source, title: `${source} — x`,
    bodyMd: "- a bullet", sort: id, status, createdAt: "2026-06-08 12:00:00", dismissedAt: null,
  } as DayView["sections"][number];
}

function runningJob(): SweepJob {
  return {
    id: "j1", status: "running", date: "2026-06-08", label: "Reset", editionId: 1, error: null,
    routines: [
      { name: "morning-brief", label: "Morning brief", status: "running" },
      { name: "partners", label: "Partner tracker", status: "pending" },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
  m.getDay.mockReset();
  m.getInsights.mockReset();
  m.startSweep.mockReset();
  m.dismissSection.mockReset();
});

describe("App", () => {
  it("renders the day's sections and a sidebar jump icon per section", async () => {
    m.getInsights.mockResolvedValue(insights);
    m.getDay.mockResolvedValue(view({ sections: [section(1, "slack"), section(2, "email")] }));

    render(<App />);
    expect(await screen.findByText("slack — x")).toBeInTheDocument();
    expect(screen.getByText("email — x")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Jump to Slack/ })).toBeInTheDocument();
    expect(screen.queryByText(/All sections cleared/)).not.toBeInTheDocument();
  });

  it("shows the cleared message only when there's no active sweep", async () => {
    m.getInsights.mockResolvedValue(insights);
    m.getDay.mockResolvedValue(view({ sections: [] }));
    render(<App />);
    expect(await screen.findByText(/All sections cleared/)).toBeInTheDocument();
  });

  it("shows progress during a sweep, suppresses the cleared message, then settles", async () => {
    vi.useFakeTimers();
    m.getInsights.mockResolvedValue(insights);
    m.getDay
      .mockResolvedValueOnce(view({ activeSweep: runningJob(), sections: [] }))
      .mockResolvedValue(view({ activeSweep: null, sections: [section(1, "slack")] }));

    render(<App />);
    await act(async () => {}); // flush the mount-effect load promises
    expect(screen.getByText("Sweeping the board…")).toBeInTheDocument();
    expect(screen.queryByText(/All sections cleared/)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500); // poll fires -> settled view
    });
    expect(screen.queryByText("Sweeping the board…")).not.toBeInTheDocument();
    expect(screen.getByText("slack — x")).toBeInTheDocument();
  });

  it("kicks off a sweep from the New sweep button", async () => {
    m.getInsights.mockResolvedValue(insights);
    m.getDay.mockResolvedValue(view({ sections: [section(1)] }));
    m.startSweep.mockResolvedValue(runningJob());

    render(<App />);
    await screen.findByText("slack — x");
    await userEvent.click(screen.getByRole("button", { name: "↻ New sweep" }));
    await waitFor(() => expect(m.startSweep).toHaveBeenCalled());
  });

  it("dismisses a section through the api and refetches", async () => {
    m.getInsights.mockResolvedValue(insights);
    m.getDay.mockResolvedValue(view({ sections: [section(3, "slack")] }));
    m.dismissSection.mockResolvedValue({});

    render(<App />);
    await screen.findByText("slack — x");
    await userEvent.click(screen.getByRole("button", { name: /section done/i }));
    await waitFor(() => expect(m.dismissSection).toHaveBeenCalledWith(3));
  });

  it("surfaces a load error", async () => {
    m.getInsights.mockResolvedValue(insights);
    m.getDay.mockRejectedValue(new Error("network down"));
    render(<App />);
    expect(await screen.findByText(/✗ Error: network down/)).toBeInTheDocument();
  });

  it("shows onboarding on first run (no config) and 'Skip' reveals the dashboard", async () => {
    m.getInsights.mockResolvedValue(insights);
    m.getDay.mockResolvedValue(view());
    m.getConfigStatus.mockResolvedValueOnce({ configured: false });

    render(<App />);
    expect(await screen.findByText(/Welcome to dayboard/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    await waitFor(() =>
      expect(screen.queryByText(/Welcome to dayboard/)).not.toBeInTheDocument(),
    );
  });
});
