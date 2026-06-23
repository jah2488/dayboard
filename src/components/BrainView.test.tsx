// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrainDiscovery,
  BrainGraph,
  BrainSearchResult,
  BrainSweepJob,
  BrainVerification,
} from "../../shared/types";

const m = vi.hoisted(() => ({
  getBrainGraph: vi.fn(),
  getBrainSweep: vi.fn(),
  startBrainSweep: vi.fn(),
  searchBrain: vi.fn(),
  getDiscoveries: vi.fn(),
  dismissDiscovery: vi.fn(),
  verifyDiscovery: vi.fn(),
  hideDiscovery: vi.fn(),
  hideNode: vi.fn(),
}));
vi.mock("../api", () => ({ api: m }));

import { BrainView } from "./BrainView";

const graph: BrainGraph = {
  docs: [
    {
      id: "learning:2026-06-08-project-alpha.md",
      kind: "learning",
      title: "Project Alpha prep",
      summary: "Notes ahead of the Project Alpha renewal.",
      date: "2026-06-08",
      origin: "direct",
      topics: [{ slug: "project-alpha", strength: 0.9, excerpt: "the TBR sequencing" }],
      missing: false,
    },
    {
      id: "session:abc-123",
      kind: "session",
      title: "Project Alpha sweep session",
      summary: "Session that wrote the Project Alpha prep doc.",
      date: "2026-06-08",
      origin: "direct",
      topics: [{ slug: "project-alpha", strength: 0.5, excerpt: null }],
      missing: false,
    },
    {
      id: "session:agent-9",
      kind: "session",
      title: "Brain sweep subagent",
      summary: "A programmatic sdk-cli run.",
      date: "2026-06-08",
      origin: "agent",
      topics: [{ slug: "project-alpha", strength: 0.3, excerpt: null }],
      missing: false,
    },
  ],
  topics: [
    {
      slug: "project-alpha",
      label: "Project Alpha",
      description: "Project Alpha partner work",
      summary:
        "Across the prep doc and its session, the Project Alpha renewal hinges on TBR sequencing before the $2.2M renewal lands.",
      summaryFingerprint: "learning:2026-06-08-project-alpha.md:2026-06-08|session:abc-123:2026-06-08",
      docCount: 2,
    },
  ],
  links: [
    {
      from: "session:abc-123",
      to: "learning:2026-06-08-project-alpha.md",
      reason: "session wrote the doc",
      origin: "artifact",
    },
  ],
  sweptAt: "2026-06-10T08:00:00Z",
  unindexed: 0,
  hidden: { docs: [], topics: [] },
};

const emptyGraph: BrainGraph = {
  docs: [],
  topics: [],
  links: [],
  sweptAt: null,
  unindexed: 12,
  hidden: { docs: [], topics: [] },
};

const runningJob: BrainSweepJob = {
  id: "b1",
  status: "running",
  startedAt: "2026-06-11T09:00:00Z",
  total: 10,
  done: 4,
  batches: 3,
  batch: 1,
  topicTotal: 0,
  topicsSummarized: 0,
  synthesizing: false,
  verifyTotal: 0,
  verified: 0,
  verifyDeferred: 0,
  newTopics: 2,
  newLinks: 5,
  newDiscoveries: 0,
  error: null,
};

const searchResult: BrainSearchResult = {
  topics: [
    {
      slug: "project-alpha",
      label: "Project Alpha",
      description: "Project Alpha partner work",
      summary: "",
      summaryFingerprint: "",
      docCount: 2,
    },
  ],
  docs: [
    {
      id: "learning:2026-06-08-project-alpha.md",
      kind: "learning",
      title: "Project Alpha prep",
      matches: [{ field: "summary", snippet: "…the Project Alpha renewal…" }],
    },
  ],
};

const pendingVerification: BrainVerification = {
  status: "pending",
  verdict: null,
  detail: "",
  evidence: [],
  checkedAt: null,
};

const doneVerification: BrainVerification = {
  status: "done",
  verdict: "confirmed",
  detail: "## Method\n\nSearched Linear and Slack for renewal traffic.",
  evidence: [
    {
      source: "linear",
      summary: "LIN-482 tracks the renewal prep",
      ref: "https://linear.app/acme/issue/LIN-482",
      supports: true,
    },
    {
      source: "logs",
      summary: "No related error spike in the logs",
      ref: "repo=project-alpha | count()",
      supports: false,
    },
  ],
  checkedAt: "2026-06-10T09:00:00Z",
};

const deferredVerification: BrainVerification = {
  status: "deferred",
  verdict: null,
  detail: "",
  evidence: [],
  checkedAt: null,
};

const trendDiscovery: BrainDiscovery = {
  id: "project-alpha-momentum",
  kind: "trend",
  title: "Project Alpha work is accelerating",
  insight:
    "Three Project Alpha docs landed this week. The renewal prep is pulling in more sessions each day.",
  topics: ["project-alpha"],
  docs: ["learning:2026-06-08-project-alpha.md", "session:abc-123"],
  status: "active",
  hidden: false,
  firstSeen: "2026-06-09T08:00:00Z",
  lastSeen: "2026-06-10T08:00:00Z",
  verification: doneVerification,
};

const fixDiscovery: BrainDiscovery = {
  id: "manual-deploy-friction",
  kind: "fix",
  title: "Deploys keep being done by hand",
  insight: "Four sessions redo the same deploy steps. A small script would end that.",
  topics: [],
  docs: ["session:abc-123"],
  status: "active",
  hidden: false,
  firstSeen: "2026-06-10T08:00:00Z",
  lastSeen: "2026-06-10T08:00:00Z",
  verification: pendingVerification,
};

const threadDiscovery: BrainDiscovery = {
  id: "renewal-thread",
  kind: "thread",
  title: "The renewal prep thread keeps growing",
  insight: "Five sessions in a row build on the same Project Alpha renewal prep.",
  topics: ["project-alpha"],
  docs: ["learning:2026-06-08-project-alpha.md"],
  status: "active",
  hidden: false,
  firstSeen: "2026-06-08T08:00:00Z",
  lastSeen: "2026-06-10T08:00:00Z",
  verification: pendingVerification,
};

// usage-limit pause — distinct copy and badge from a real failure.
const deferredDiscovery: BrainDiscovery = {
  id: "usage-limit-pause",
  kind: "fix",
  title: "Verification hit the usage limit",
  insight: "The research pass aborted on the shared Claude usage limit.",
  topics: [],
  docs: ["session:abc-123"],
  status: "active",
  hidden: false,
  firstSeen: "2026-06-10T08:00:00Z",
  lastSeen: "2026-06-10T08:00:00Z",
  verification: deferredVerification,
};

// majority of evidence docs are agent-origin sessions — an AI-to-AI thread.
const metaDiscovery: BrainDiscovery = {
  id: "agent-chatter",
  kind: "thread",
  title: "The agents keep talking to each other",
  insight: "A run of programmatic sessions reference one another, no human in the loop.",
  topics: ["project-alpha"],
  docs: ["session:agent-9"],
  status: "active",
  hidden: false,
  firstSeen: "2026-06-10T08:00:00Z",
  lastSeen: "2026-06-10T08:00:00Z",
  verification: pendingVerification,
};

function renderView(over: Partial<Parameters<typeof BrainView>[0]> = {}) {
  return render(
    <BrainView onOpenLearning={vi.fn()} onOpenSession={vi.fn()} {...over} />,
  );
}

const detail = () => within(document.querySelector(".brain-detail") as HTMLElement);

// The runner's global localStorage is Node's experimental webstorage, which is
// non-functional without --localstorage-file. Pin a tiny in-memory one so the
// collapse-persistence path is actually exercised instead of degrading quietly.
const stored = new Map<string, string>();
beforeAll(() => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
    clear: () => stored.clear(),
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

// Most tests don't care about discoveries — default to none so the section
// stays out of the way; discovery tests override per-case.
beforeEach(() => {
  m.getDiscoveries.mockResolvedValue([]);
});

afterEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  localStorage.clear();
});

describe("BrainView", () => {
  it("renders the header stats from the graph", async () => {
    m.getBrainGraph.mockResolvedValue(graph);
    m.getBrainSweep.mockResolvedValue(null);
    renderView();
    expect(await screen.findByText("3 docs · 1 topic · 1 link")).toBeInTheDocument();
  });

  it("shows the first-sweep explainer before any sweep has run", async () => {
    m.getBrainGraph.mockResolvedValue(emptyGraph);
    m.getBrainSweep.mockResolvedValue(null);
    renderView();
    expect(
      await screen.findByRole("button", { name: "🧠 Run first brain sweep" }),
    ).toBeInTheDocument();
  });

  it("starts a sweep and shows progress from the running job", async () => {
    m.getBrainGraph.mockResolvedValue(graph);
    m.getBrainSweep.mockResolvedValue(null);
    m.startBrainSweep.mockResolvedValue(runningJob);
    renderView();
    await userEvent.click(await screen.findByRole("button", { name: "↻ Sweep brain" }));
    expect(m.startBrainSweep).toHaveBeenCalled();
    expect(await screen.findByText("batch 1/3 · 4/10 docs")).toBeInTheDocument();
  });

  it("surfaces a failed sweep's error", async () => {
    m.getBrainGraph.mockResolvedValue(graph);
    m.getBrainSweep.mockResolvedValue({ ...runningJob, status: "error", error: "claude exploded" });
    renderView();
    expect(await screen.findByText("✗ claude exploded")).toBeInTheDocument();
  });

  it("searches after a pause and opens the topic detail from a result", async () => {
    m.getBrainGraph.mockResolvedValue(graph);
    m.getBrainSweep.mockResolvedValue(null);
    m.searchBrain.mockResolvedValue(searchResult);
    renderView();
    await userEvent.type(
      await screen.findByPlaceholderText("Search your brain…"),
      "project-alpha",
    );
    const results = within(await screen.findByRole("list", { name: "Search results" }));
    await userEvent.click(await results.findByRole("button", { name: /⊚ Project Alpha/ }));
    expect(m.searchBrain).toHaveBeenCalledWith("project-alpha");
    expect(detail().getByText("Project Alpha partner work")).toBeInTheDocument();
    // member docs show the excerpt for this topic
    expect(detail().getByText("“the TBR sequencing”")).toBeInTheDocument();
  });

  it("renders the topic's key-findings summary before the hide button and the Documents list", async () => {
    m.getBrainGraph.mockResolvedValue(graph);
    m.getBrainSweep.mockResolvedValue(null);
    m.searchBrain.mockResolvedValue(searchResult);
    renderView();
    await userEvent.type(await screen.findByPlaceholderText("Search your brain…"), "project-alpha");
    const results = within(await screen.findByRole("list", { name: "Search results" }));
    await userEvent.click(await results.findByRole("button", { name: /⊚ Project Alpha/ }));

    const summary = detail().getByText(/the Project Alpha renewal hinges on TBR sequencing/);
    const hide = detail().getByRole("button", { name: "🙈 Hide from map" });
    const docsLabel = detail().getByText("Documents (3)");
    // order: title, description, KEY-FINDINGS SUMMARY, hide, Documents list
    expect(summary.compareDocumentPosition(hide)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(summary.compareDocumentPosition(docsLabel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows the calm fallback when a topic has no summary yet", async () => {
    const noSummary: BrainGraph = {
      ...graph,
      topics: [{ ...graph.topics[0], summary: "" }],
    };
    m.getBrainGraph.mockResolvedValue(noSummary);
    m.getBrainSweep.mockResolvedValue(null);
    m.searchBrain.mockResolvedValue(searchResult);
    renderView();
    await userEvent.type(await screen.findByPlaceholderText("Search your brain…"), "project-alpha");
    const results = within(await screen.findByRole("list", { name: "Search results" }));
    await userEvent.click(await results.findByRole("button", { name: /⊚ Project Alpha/ }));
    expect(
      detail().getByText("No summary yet — the next brain sweep will write one."),
    ).toBeInTheDocument();
  });

  it("opens a learning from the doc detail with the bare filename", async () => {
    const onOpenLearning = vi.fn();
    m.getBrainGraph.mockResolvedValue(graph);
    m.getBrainSweep.mockResolvedValue(null);
    renderView({ onOpenLearning });
    await userEvent.click(
      await screen.findByRole("button", { name: "Learning doc Project Alpha prep" }),
    );
    expect(detail().getByText("Notes ahead of the Project Alpha renewal.")).toBeInTheDocument();
    await userEvent.click(detail().getByRole("button", { name: "Open document →" }));
    expect(onOpenLearning).toHaveBeenCalledWith("2026-06-08-project-alpha.md");
  });

  it("opens a session from the doc detail with the bare uuid", async () => {
    const onOpenSession = vi.fn();
    m.getBrainGraph.mockResolvedValue(graph);
    m.getBrainSweep.mockResolvedValue(null);
    renderView({ onOpenSession });
    await userEvent.click(
      await screen.findByRole("button", { name: "Session Project Alpha sweep session" }),
    );
    await userEvent.click(detail().getByRole("button", { name: "Open document →" }));
    expect(onOpenSession).toHaveBeenCalledWith("abc-123");
  });

  it("surfaces a load error", async () => {
    m.getBrainGraph.mockRejectedValue(new Error("boom"));
    m.getBrainSweep.mockResolvedValue(null);
    renderView();
    expect(await screen.findByText(/✗ Error: boom/)).toBeInTheDocument();
  });
});

describe("BrainView discoveries", () => {
  beforeEach(() => {
    m.getBrainGraph.mockResolvedValue(graph);
    m.getBrainSweep.mockResolvedValue(null);
    m.hideDiscovery.mockResolvedValue(undefined);
    m.hideNode.mockResolvedValue({ docs: [], topics: [] });
  });

  it("renders discovery cards with kind label, title, insight, and evidence count", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery, fixDiscovery]);
    const { container } = renderView();
    expect(await screen.findByText("Project Alpha work is accelerating")).toBeInTheDocument();
    expect(screen.getByText(/Three Project Alpha docs landed this week/)).toBeInTheDocument();
    expect(screen.getByText("2 docs")).toBeInTheDocument();
    expect(screen.getByText("1 doc")).toBeInTheDocument();
    const chips = [...container.querySelectorAll(".discovery-kind")].map((el) => el.textContent);
    expect(chips).toEqual(["📈 trend", "🔧 fix"]);
    expect(
      screen.queryByText(/No cross-document discoveries yet/),
    ).not.toBeInTheDocument();
  });

  it("renders below the graph layout, not above it", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    const { container } = renderView();
    await screen.findByText("Project Alpha work is accelerating");
    const layout = container.querySelector(".brain-layout") as HTMLElement;
    const discoveries = container.querySelector(".discoveries") as HTMLElement;
    expect(layout.compareDocumentPosition(discoveries)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("groups discoveries into kind sections in thread→trend→fix→pattern order with counts", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery, fixDiscovery, threadDiscovery]);
    const { container } = renderView();
    await screen.findByText("Project Alpha work is accelerating");
    const titles = [...container.querySelectorAll(".discovery-section-title")].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(["🪢 thread", "📈 trend", "🔧 fix"]);
    const counts = [...container.querySelectorAll(".discovery-section-count")].map(
      (el) => el.textContent,
    );
    expect(counts).toEqual(["1", "1", "1"]);
    // pending hypotheses surface as a small unverified count on the header
    expect(screen.getByRole("button", { name: /🔧 fix/ })).toHaveTextContent("1 unverified");
    expect(screen.getByRole("button", { name: /📈 trend/ })).not.toHaveTextContent("unverified");
  });

  it("collapses a section on header click and persists the choice across remounts", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    const first = renderView();
    const head = await screen.findByRole("button", { name: /📈 trend/ });
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Project Alpha work is accelerating")).toBeInTheDocument();

    await userEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Project Alpha work is accelerating")).not.toBeInTheDocument();
    expect(localStorage.getItem("dayboard:brain-discoveries-collapsed")).toContain("trend");

    first.unmount();
    renderView();
    const head2 = await screen.findByRole("button", { name: /📈 trend/ });
    expect(head2).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Project Alpha work is accelerating")).not.toBeInTheDocument();
  });

  it("shows one muted line when sweeps have run but nothing emerged", async () => {
    renderView();
    expect(
      await screen.findByText(
        "No cross-document discoveries yet — they emerge as the graph grows.",
      ),
    ).toBeInTheDocument();
  });

  it("dismisses a discovery optimistically", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    m.dismissDiscovery.mockResolvedValue({ ...trendDiscovery, status: "dismissed" });
    renderView();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Dismiss (permanent): Project Alpha work is accelerating",
      }),
    );
    expect(m.dismissDiscovery).toHaveBeenCalledWith("project-alpha-momentum");
    expect(screen.queryByText("Project Alpha work is accelerating")).not.toBeInTheDocument();
  });

  it("restores the card and shows a notice when dismiss fails", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    m.dismissDiscovery.mockRejectedValue(new Error("offline"));
    renderView();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Dismiss (permanent): Project Alpha work is accelerating",
      }),
    );
    expect(await screen.findByText(/✗ Error: offline/)).toBeInTheDocument();
    expect(screen.getByText("Project Alpha work is accelerating")).toBeInTheDocument();
  });

  it("expanding a card rings its evidence docs and topics in the graph, toggling off on re-click", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    const { container } = renderView();
    const title = await screen.findByRole("button", {
      name: "Project Alpha work is accelerating",
    });
    expect(container.querySelectorAll(".bg-ring")).toHaveLength(0);

    await userEvent.click(title);
    // 2 evidence docs + 1 topic
    expect(container.querySelectorAll(".bg-ring")).toHaveLength(3);
    expect(title).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".discovery")).toHaveClass("expanded");

    await userEvent.click(title);
    expect(container.querySelectorAll(".bg-ring")).toHaveLength(0);
    expect(container.querySelector(".discovery")).not.toHaveClass("expanded");
  });

  it("expands a card to the verification deep dive with evidence and internal sources", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: "Project Alpha work is accelerating" }),
    );
    expect(screen.getByText("✓ confirmed")).toBeInTheDocument();
    expect(screen.getByText(/^checked /)).toBeInTheDocument();
    // detail is markdown — the heading renders as a real heading
    expect(screen.getByRole("heading", { name: "Method" })).toBeInTheDocument();
    expect(
      screen.getByText("Searched Linear and Slack for renewal traffic."),
    ).toBeInTheDocument();
    // external evidence: known sources reuse SOURCE_META, unknown fall back to 🔗 + name
    expect(screen.getByText("📐 Linear")).toBeInTheDocument();
    expect(screen.getByText("🔗 logs")).toBeInTheDocument();
    expect(screen.getByText("supports")).toBeInTheDocument();
    expect(screen.getByText("contradicts")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://linear.app/acme/issue/LIN-482" }),
    ).toHaveAttribute("href", "https://linear.app/acme/issue/LIN-482");
    // non-http refs render as code, not a link
    expect(screen.getByText("repo=project-alpha | count()")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "repo=project-alpha | count()" }),
    ).not.toBeInTheDocument();
    // internal sources select the doc in the graph detail panel
    await userEvent.click(screen.getByRole("button", { name: "📚 Project Alpha prep" }));
    expect(detail().getByText("Notes ahead of the Project Alpha renewal.")).toBeInTheDocument();
  });

  it("explains a pending verification calmly", async () => {
    m.getDiscoveries.mockResolvedValue([fixDiscovery]);
    renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: "Deploys keep being done by hand" }),
    );
    expect(screen.getByText("⏳ not yet verified")).toBeInTheDocument();
    expect(
      screen.getByText(
        /the next sweep will research this against Slack, Linear, Datadog and friends/,
      ),
    ).toBeInTheDocument();
  });

  it("re-verifies from the expanded card, optimistically showing running", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    m.verifyDiscovery.mockResolvedValue({
      ...trendDiscovery,
      verification: { ...doneVerification, status: "running" },
    });
    renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: "Project Alpha work is accelerating" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "↻ Re-verify" }));
    expect(m.verifyDiscovery).toHaveBeenCalledWith("project-alpha-momentum");
    expect(await screen.findByText("… verifying")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "↻ Re-verify" })).toBeDisabled();
  });

  it("surfaces a notice when re-verify is rejected (409 already running)", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    m.verifyDiscovery.mockRejectedValue(new Error("409 Conflict"));
    renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: "Project Alpha work is accelerating" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "↻ Re-verify" }));
    expect(await screen.findByText(/✗ Error: 409 Conflict/)).toBeInTheDocument();
  });

  it("an active search query takes the highlights over the expanded discovery", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    m.searchBrain.mockResolvedValue(searchResult);
    const { container } = renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: "Project Alpha work is accelerating" }),
    );
    expect(container.querySelectorAll(".bg-ring")).toHaveLength(3);

    await userEvent.type(screen.getByPlaceholderText("Search your brain…"), "project-alpha");
    await screen.findByRole("list", { name: "Search results" });
    // search hits: the project-alpha topic + one doc — the discovery's 3 stand down
    expect(container.querySelectorAll(".bg-ring")).toHaveLength(2);
  });

  it("a topic chip selects that topic in the detail panel", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    renderView();
    await userEvent.click(await screen.findByRole("button", { name: "⊚ Project Alpha" }));
    expect(detail().getByText("Project Alpha partner work")).toBeInTheDocument();
  });

  it("shows the synthesizing banner instead of the batch counter", async () => {
    m.getBrainSweep.mockResolvedValue({ ...runningJob, batch: 3, synthesizing: true });
    renderView();
    expect(await screen.findByText("synthesizing discoveries…")).toBeInTheDocument();
    expect(screen.queryByText(/batch 3/)).not.toBeInTheDocument();
  });

  it("shows the verifying-hypotheses stage from the job counters", async () => {
    m.getBrainSweep.mockResolvedValue({
      ...runningJob,
      batch: 3,
      synthesizing: false,
      verifyTotal: 4,
      verified: 1,
    });
    renderView();
    expect(await screen.findByText("verifying hypotheses 1/4…")).toBeInTheDocument();
    expect(screen.queryByText(/batch 3/)).not.toBeInTheDocument();
  });

  it("shows the summarizing-topics stage from the job counters", async () => {
    m.getBrainSweep.mockResolvedValue({
      ...runningJob,
      batch: 3,
      synthesizing: false,
      verifyTotal: 0,
      topicTotal: 5,
      topicsSummarized: 2,
    });
    renderView();
    expect(await screen.findByText("summarizing topics 2/5…")).toBeInTheDocument();
    expect(screen.queryByText(/batch 3/)).not.toBeInTheDocument();
  });

  it("refetches discoveries when a sweep settles", async () => {
    vi.useFakeTimers();
    try {
      m.getBrainSweep
        .mockResolvedValueOnce(runningJob)
        .mockResolvedValue({ ...runningJob, status: "done", done: 10, newDiscoveries: 1 });
      renderView();
      // mount load, then the post-settle refetch from the poll. waitFor only
      // advances fake timers as far as its timeout — give it room for the
      // 2.5s poll interval.
      await vi.waitFor(() => expect(m.getDiscoveries).toHaveBeenCalledTimes(2), {
        timeout: 10_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls discoveries while a verification is running", async () => {
    vi.useFakeTimers();
    try {
      m.getDiscoveries
        .mockResolvedValueOnce([
          {
            ...trendDiscovery,
            verification: { ...doneVerification, status: "running" as const },
          },
        ])
        .mockResolvedValue([trendDiscovery]);
      renderView();
      // mount load sees a running verification; the ~4s poll refetches and
      // stands down once the record comes back done.
      await vi.waitFor(() => expect(m.getDiscoveries).toHaveBeenCalledTimes(2), {
        timeout: 10_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the verdict badge on the collapsed card, not just when expanded", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    const { container } = renderView();
    await screen.findByText("Project Alpha work is accelerating");
    // collapsed: the badge already reads in the head
    expect(container.querySelector(".discovery")).not.toHaveClass("expanded");
    const badge = container.querySelector(".discovery-verdict");
    expect(badge?.textContent).toBe("✓ confirmed");
    // one badge for both states — expanding doesn't add a second
    await userEvent.click(screen.getByRole("button", { name: "Project Alpha work is accelerating" }));
    expect(container.querySelectorAll(".discovery-verdict")).toHaveLength(1);
  });

  it("shows a deferred badge and its distinct usage-limit copy", async () => {
    m.getDiscoveries.mockResolvedValue([deferredDiscovery]);
    const { container } = renderView();
    await screen.findByText("Verification hit the usage limit");
    expect(container.querySelector(".discovery-verdict")?.textContent).toBe("⏸ deferred");
    // section flags split deferred out from unverified
    expect(screen.getByRole("button", { name: /🔧 fix/ })).toHaveTextContent("1 deferred");
    await userEvent.click(
      screen.getByRole("button", { name: "Verification hit the usage limit" }),
    );
    expect(
      screen.getByText(/the Claude usage limit was hit; the next sweep will retry/),
    ).toBeInTheDocument();
    // re-verify still works for a deferred hypothesis
    expect(screen.getByRole("button", { name: "↻ Re-verify" })).toBeEnabled();
  });

  it("hides a discovery optimistically, then Show hidden reveals it ghosted with an unhide", async () => {
    m.getDiscoveries.mockResolvedValue([trendDiscovery]);
    renderView();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Hide (reversible): Project Alpha work is accelerating",
      }),
    );
    expect(m.hideDiscovery).toHaveBeenCalledWith("project-alpha-momentum", true);
    expect(screen.queryByText("Project Alpha work is accelerating")).not.toBeInTheDocument();

    // the header toggle appears once something is hidden
    await userEvent.click(screen.getByRole("button", { name: /Show hidden \(1\)/ }));
    const card = screen.getByText("Project Alpha work is accelerating").closest(".discovery");
    expect(card).toHaveClass("hidden");
    await userEvent.click(
      screen.getByRole("button", { name: "Unhide discovery: Project Alpha work is accelerating" }),
    );
    expect(m.hideDiscovery).toHaveBeenLastCalledWith("project-alpha-momentum", false);
  });

  it("hides a graph node from the detail panel and drops it from the layout", async () => {
    m.hideNode.mockResolvedValue({ docs: ["session:agent-9"], topics: [] });
    renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: "Agent session Brain sweep subagent" }),
    );
    await userEvent.click(detail().getByRole("button", { name: "🙈 Hide from map" }));
    expect(m.hideNode).toHaveBeenCalledWith("doc", "session:agent-9", true);
    // optimistic + server truth both drop it from the default layout
    expect(
      screen.queryByRole("button", { name: /Brain sweep subagent$/ }),
    ).not.toBeInTheDocument();
  });

  it("marks a meta discovery (majority agent-origin sources) with a 🤖 internal tag", async () => {
    m.getDiscoveries.mockResolvedValue([metaDiscovery]);
    renderView();
    await screen.findByText("The agents keep talking to each other");
    expect(screen.getByText("🤖 internal")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "The agents keep talking to each other" }),
    );
    expect(
      screen.getByText(/Sourced from automated agent sessions \(AI-to-AI\)/),
    ).toBeInTheDocument();
  });
});
