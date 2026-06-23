// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionCategory, SessionDetail, SessionListItem } from "../../shared/types";

const m = vi.hoisted(() => ({ listSessions: vi.fn(), getSession: vi.fn() }));
vi.mock("../api", () => ({ api: m }));

import { SessionsView } from "./SessionsView";

function item(id: string, category: SessionCategory, title: string): SessionListItem {
  return {
    id,
    project: "proj",
    cwd: null,
    title,
    goalPreview: "",
    startedAt: null,
    endedAt: "2026-06-23T00:00:00.000Z",
    mtime: 1,
    running: false,
    origin: category === "interactive" ? "direct" : "agent",
    category,
    tags: [],
    prCount: 0,
    learningCount: 0,
    stats: {
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: { total: 0, byName: [] },
      web: { searches: 0, fetches: 0 },
      tokens: { contextHighWater: 0, totalOutput: 0, totalInput: 0 },
      models: [],
      durationMs: null,
      startedAt: null,
      endedAt: null,
    },
  };
}

const sessions = [
  item("s1", "interactive", "Mine one"),
  item("s2", "interactive", "Mine two"),
  item("s3", "agent", "Agent one"),
  item("s4", "sweep", "Sweep one"),
];

const detailFor = (s: SessionListItem): SessionDetail => ({
  ...s,
  gitBranch: null,
  goal: "",
  results: "",
  prs: [],
  learnings: [],
  turns: [],
  summary: null,
});

beforeEach(() => {
  m.listSessions.mockResolvedValue(sessions);
  // any selected id resolves to a valid detail (persisted across async tails)
  m.getSession.mockImplementation((id: string) =>
    Promise.resolve(detailFor(sessions.find((s) => s.id === id) ?? sessions[0])),
  );
});
afterEach(() => {
  m.listSessions.mockClear();
  m.getSession.mockClear();
});

function listItems() {
  // the session buttons in the left list, by their title text
  return Array.from(document.querySelectorAll(".sess-item")).map((b) => b.textContent ?? "");
}

describe("SessionsView category filter", () => {
  it("defaults to Mine (interactive) and hides agent/sweep sessions", async () => {
    render(<SessionsView onOpenLearning={() => {}} />);
    await waitFor(() => expect(listItems().length).toBe(2));
    expect(listItems().join("|")).toMatch(/Mine one/);
    expect(listItems().join("|")).not.toMatch(/Agent one|Sweep one/);
  });

  it("shows per-bucket counts and switches to agents on click", async () => {
    render(<SessionsView onOpenLearning={() => {}} />);
    await waitFor(() => expect(listItems().length).toBe(2));

    const group = screen.getByRole("group", { name: /Filter sessions/ });
    expect(within(group).getByRole("button", { name: /Mine\s*2/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /Agents\s*1/ })).toBeInTheDocument();

    await userEvent.click(within(group).getByRole("button", { name: /Agents/ }));
    await waitFor(() => expect(listItems().join("|")).toMatch(/Agent one/));
    expect(listItems().join("|")).not.toMatch(/Mine one/);
  });
});
