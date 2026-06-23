// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Section } from "../../shared/types";
import { Sidebar } from "./Sidebar";

// jsdom doesn't implement scrollIntoView; stub it so the click path is testable.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.clearAllMocks();
  document.body.querySelectorAll("[data-anchor]").forEach((n) => n.remove());
});

let nextId = 0;
function section(over: Partial<Section> = {}): Section {
  nextId += 1;
  return {
    id: nextId,
    editionId: 1,
    date: "2026-06-08",
    source: "slack",
    title: "Slack — needs a reply",
    bodyMd: "",
    sort: 0,
    status: "active",
    createdAt: "2026-06-08 12:00:00",
    dismissedAt: null,
    ...over,
  };
}

function renderSidebar(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return render(
    <Sidebar
      tab="today"
      onTab={() => {}}
      date="2026-06-08"
      onDate={() => {}}
      sections={[]}
      tabs={["today", "trends", "prs", "learnings", "sessions", "brain"]}
      {...props}
    />,
  );
}

describe("Sidebar jump nav", () => {
  it("is hidden when the tab is not 'today'", () => {
    renderSidebar({ tab: "trends", sections: [section()] });
    expect(screen.queryByText("Jump to")).not.toBeInTheDocument();
  });

  it("is hidden when there are no sections", () => {
    renderSidebar({ sections: [] });
    expect(screen.queryByText("Jump to")).not.toBeInTheDocument();
  });

  it("renders one icon button per section, labelled by source + title", () => {
    renderSidebar({
      sections: [
        section({ source: "slack", title: "Slack — needs a reply" }),
        section({ source: "email", title: "Email — needs a reply" }),
      ],
    });
    expect(
      screen.getByRole("button", { name: /Jump to Slack: Slack/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Jump to Email: Email/ }),
    ).toBeInTheDocument();
  });

  it("grays out cleared (non-active) sections", () => {
    renderSidebar({
      sections: [
        section({ status: "active", title: "Active one" }),
        section({ status: "done", title: "Done one" }),
      ],
    });
    expect(
      screen.getByRole("button", { name: /Active one/ }),
    ).not.toHaveClass("done");
    expect(screen.getByRole("button", { name: /Done one/ })).toHaveClass(
      "done",
    );
  });

  it("scrolls to the matching section anchor on click", async () => {
    const s = section({ title: "Linear bits", source: "linear" });
    const anchor = document.createElement("div");
    anchor.id = `section-${s.id}`;
    anchor.setAttribute("data-anchor", "");
    document.body.appendChild(anchor);

    renderSidebar({ sections: [s] });
    await userEvent.click(screen.getByRole("button", { name: /Linear bits/ }));
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("opens the Cleared tray before scrolling to a dismissed section", async () => {
    const s = section({ status: "done", title: "Cleared bit" });
    const details = document.createElement("details");
    details.setAttribute("data-anchor", "");
    const row = document.createElement("div");
    row.id = `section-${s.id}`;
    details.appendChild(row);
    document.body.appendChild(details);
    expect(details.open).toBe(false);

    renderSidebar({ sections: [s] });
    await userEvent.click(screen.getByRole("button", { name: /Cleared bit/ }));
    expect(details.open).toBe(true);
    expect(row.scrollIntoView).toHaveBeenCalled();
  });

  it("does nothing when the anchor is absent", async () => {
    renderSidebar({ sections: [section({ title: "Ghost" })] });
    await userEvent.click(screen.getByRole("button", { name: /Ghost/ }));
    // no throw, no scroll
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
