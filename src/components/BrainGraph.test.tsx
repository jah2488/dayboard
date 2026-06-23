// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BrainGraph as Graph } from "../../shared/types";
import { BrainGraph } from "./BrainGraph";

const graph: Graph = {
  docs: [
    {
      id: "learning:2026-06-08-project-alpha.md",
      kind: "learning",
      title: "Project Alpha prep",
      summary: "Notes ahead of the Project Alpha renewal.",
      date: "2026-06-08",
      origin: "direct",
      topics: [{ slug: "project-alpha", strength: 0.9, excerpt: null }],
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
      summary: "A programmatic sdk-cli run — AI-to-AI chatter.",
      date: "2026-06-08",
      origin: "agent",
      topics: [{ slug: "project-alpha", strength: 0.3, excerpt: null }],
      missing: false,
    },
    {
      id: "learning:gone.md",
      kind: "learning",
      title: "Deleted doc",
      summary: "Source file no longer exists.",
      date: null,
      origin: "direct",
      topics: [{ slug: "project-alpha", strength: 0.4, excerpt: null }],
      missing: true,
    },
  ],
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
  links: [
    {
      from: "session:abc-123",
      to: "learning:2026-06-08-project-alpha.md",
      reason: "session wrote the doc",
      origin: "artifact",
    },
    {
      from: "session:abc-123",
      to: "learning:gone.md",
      reason: "links into a missing doc",
      origin: "ai",
    },
  ],
  sweptAt: "2026-06-10T08:00:00Z",
  unindexed: 0,
  hidden: { docs: [], topics: [] },
};

function renderGraph(onSelect = vi.fn(), over: Partial<Graph> = {}, showHidden = false) {
  render(
    <BrainGraph
      graph={{ ...graph, ...over }}
      showHidden={showHidden}
      selected={null}
      multiKeys={new Set()}
      highlightIds={new Set()}
      onSelect={onSelect}
      onClear={vi.fn()}
    />,
  );
  return onSelect;
}

describe("BrainGraph", () => {
  it("renders a focusable node per topic and live doc, and a line per connection", () => {
    renderGraph();
    // 1 topic + 3 live docs; the missing doc and its link are left out
    expect(document.querySelectorAll(".bg-node")).toHaveLength(4);
    // 3 memberships + 1 doc→doc link
    expect(document.querySelectorAll("line")).toHaveLength(4);
  });

  it("labels every node for assistive tech", () => {
    renderGraph();
    expect(screen.getByRole("button", { name: "Topic Project Alpha, 2 documents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Learning doc Project Alpha prep" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Session Project Alpha sweep session" })).toBeInTheDocument();
  });

  it("distinguishes an agent-origin session node and names it for assistive tech", () => {
    renderGraph();
    const agent = screen.getByRole("button", { name: "Agent session Brain sweep subagent" });
    expect(agent).toHaveClass("agent");
    // direct sessions stay plain — no agent marker bleeding onto them
    expect(
      screen.getByRole("button", { name: "Session Project Alpha sweep session" }),
    ).not.toHaveClass("agent");
    // the 🤖 affordance rides on the agent node, not on direct sessions
    expect(agent.querySelector(".bg-agent-mark")?.textContent).toBe("🤖");
  });

  it("drops hidden nodes from the layout by default and ghosts them under Show hidden", () => {
    const { rerender } = render(
      <BrainGraph
        graph={{ ...graph, hidden: { docs: ["session:agent-9"], topics: [] } }}
        showHidden={false}
        selected={null}
        multiKeys={new Set()}
        highlightIds={new Set()}
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Brain sweep subagent/ }),
    ).not.toBeInTheDocument();

    rerender(
      <BrainGraph
        graph={{ ...graph, hidden: { docs: ["session:agent-9"], topics: [] } }}
        showHidden={true}
        selected={null}
        multiKeys={new Set()}
        highlightIds={new Set()}
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const ghost = screen.getByRole("button", { name: "Agent session Brain sweep subagent (hidden)" });
    expect(ghost).toHaveClass("hidden");
  });

  it("renders a legend naming the node kinds incl. agent vs direct sessions", () => {
    renderGraph();
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(legend).toHaveTextContent("topic");
    expect(legend).toHaveTextContent("learning");
    expect(legend).toHaveTextContent("🤖 agent session");
  });

  it("selects a topic on click (no modifier = not additive)", async () => {
    const onSelect = renderGraph();
    await userEvent.click(screen.getByRole("button", { name: "Topic Project Alpha, 2 documents" }));
    expect(onSelect).toHaveBeenCalledWith({ type: "topic", id: "project-alpha" }, false);
  });

  it("cmd/ctrl-click on a topic selects additively (for overlap)", () => {
    const onSelect = renderGraph();
    fireEvent.click(screen.getByRole("button", { name: "Topic Project Alpha, 2 documents" }), {
      metaKey: true,
    });
    expect(onSelect).toHaveBeenCalledWith({ type: "topic", id: "project-alpha" }, true);
  });

  it("renders a dashed ring on multi-selected (overlap) nodes", () => {
    render(
      <BrainGraph
        graph={graph}
        showHidden={false}
        selected={null}
        multiKeys={new Set(["topic:project-alpha"])}
        highlightIds={new Set()}
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(document.querySelector(".bg-multi-ring")).toBeInTheDocument();
  });

  it("selects a doc with the keyboard", async () => {
    const onSelect = renderGraph();
    screen.getByRole("button", { name: "Session Project Alpha sweep session" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith({ type: "doc", id: "session:abc-123" }, false);
  });

  it("shows a friendly message when nothing is connected yet", () => {
    render(
      <BrainGraph
        graph={{ ...graph, topics: [], links: [] }}
        showHidden={false}
        selected={null}
        multiKeys={new Set()}
        highlightIds={new Set()}
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nothing connected yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
