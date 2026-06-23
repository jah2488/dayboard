// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DayboardConfig } from "../../shared/types";

const m = vi.hoisted(() => ({
  getConfigCheck: vi.fn(),
  getRoutines: vi.fn(),
  patchConfig: vi.fn(),
  saveRoutinePrompt: vi.fn(),
  setSchedule: vi.fn(),
}));
vi.mock("../api", () => ({ api: m }));

import { SettingsView } from "./SettingsView";

function config(over: Partial<DayboardConfig> = {}): DayboardConfig {
  return {
    identity: { name: "Ada", addressAs: "you" },
    paths: { learningsDir: "/l", claudeProjectsDir: "/c" },
    schedule: { hour: 7, minute: 0 },
    models: { tag: "haiku", reason: "sonnet" },
    github: { org: "acme", defaultChannel: "#cr", repoChannels: {}, repoKeywordRules: {} },
    tabs: { today: true, trends: true, prs: true, learnings: true, sessions: true, brain: true },
    routines: [{ name: "morning-brief", label: "Morning brief", enabled: true }],
    connectors: [],
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

function primeApi() {
  m.getConfigCheck.mockResolvedValue({
    ok: false,
    checks: [
      { id: "claude-bin", label: "Claude CLI", status: "fail", detail: "not on PATH" },
      { id: "identity", label: "Identity", status: "ok", detail: 'Greeting as "Ada"' },
    ],
  });
  m.getRoutines.mockResolvedValue({
    sweep: [
      {
        name: "morning-brief",
        label: "Morning brief",
        enabled: true,
        source: "template",
        raw: "Brief for {{identity.name}}",
        rendered: "Brief for Ada",
      },
    ],
    brain: [
      { name: "brain-sweep", label: "brain-sweep", enabled: false, source: "template", raw: "BS", rendered: "BS" },
    ],
  });
  m.patchConfig.mockImplementation((patch) => Promise.resolve({ ...config(), ...patch }));
}

describe("SettingsView", () => {
  it("renders the setup-check results with status glyphs", async () => {
    primeApi();
    render(<SettingsView config={config()} onChange={() => {}} />);
    expect(await screen.findByText("Claude CLI")).toBeInTheDocument();
    expect(screen.getByText("not on PATH")).toBeInTheDocument();
    expect(screen.getByText(/Greeting as "Ada"/)).toBeInTheDocument();
  });

  it("toggling a tab patches config and lifts the result up", async () => {
    primeApi();
    const onChange = vi.fn();
    render(<SettingsView config={config()} onChange={onChange} />);
    // The "PRs" tab toggle is checked; click it off.
    const prs = screen.getByRole("checkbox", { name: /PRs/ });
    await userEvent.click(prs);
    await waitFor(() => expect(m.patchConfig).toHaveBeenCalledWith({ tabs: { prs: false } }));
    expect(onChange).toHaveBeenCalled();
  });

  it("opens a routine prompt and saves an override", async () => {
    primeApi();
    m.saveRoutinePrompt.mockResolvedValue({
      name: "morning-brief",
      label: "Morning brief",
      enabled: true,
      source: "override",
      raw: "Brief for {{identity.name}} EDITED",
      rendered: "Brief for Ada EDITED",
    });
    render(<SettingsView config={config()} onChange={() => {}} />);
    await userEvent.click((await screen.findAllByText("View / edit prompt"))[0]);
    const textarea = screen.getByDisplayValue("Brief for {{identity.name}}");
    await userEvent.type(textarea, " EDITED");
    await userEvent.click(screen.getByText("Save override"));
    await waitFor(() =>
      expect(m.saveRoutinePrompt).toHaveBeenCalledWith(
        "morning-brief",
        "Brief for {{identity.name}} EDITED",
      ),
    );
  });

  it("saving the schedule calls setSchedule and shows the result", async () => {
    primeApi();
    m.setSchedule.mockResolvedValue({ applied: true, detail: "Rescheduled to 8:30 and reloaded." });
    render(<SettingsView config={config()} onChange={() => {}} />);
    const time = await screen.findByDisplayValue("07:00");
    await userEvent.clear(time);
    await userEvent.type(time, "08:30");
    time.blur();
    await waitFor(() => expect(m.setSchedule).toHaveBeenCalledWith(8, 30));
    expect(await screen.findByText(/Rescheduled to 8:30/)).toBeInTheDocument();
  });
});
