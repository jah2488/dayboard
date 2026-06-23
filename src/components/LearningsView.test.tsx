// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningContent, LearningDoc } from "../../shared/types";

const listLearnings = vi.fn();
const getLearning = vi.fn();
vi.mock("../api", () => ({ api: { listLearnings: () => listLearnings(), getLearning: (f: string) => getLearning(f) } }));

import { LearningsView } from "./LearningsView";

const docs: LearningDoc[] = [
  { file: "2026-06-08-project-alpha.md", title: "Project Alpha prep", date: "2026-06-08", slug: "project-alpha", mtime: 2 },
  { file: "2026-06-01-ct.md", title: "Project Beta", date: "2026-06-01", slug: "ct", mtime: 1 },
];
const content: LearningContent = { file: "2026-06-08-project-alpha.md", title: "Project Alpha prep", date: "2026-06-08", slug: "project-alpha", content: "# Project Alpha prep\n\nthe body" };

afterEach(() => {
  listLearnings.mockReset();
  getLearning.mockReset();
});

describe("LearningsView", () => {
  it("auto-selects the newest doc and renders its content", async () => {
    listLearnings.mockResolvedValue(docs);
    getLearning.mockResolvedValue(content);
    render(<LearningsView />);
    expect(await screen.findByText("the body")).toBeInTheDocument();
    expect(getLearning).toHaveBeenCalledWith("2026-06-08-project-alpha.md");
  });

  it("filters the list by the search query", async () => {
    listLearnings.mockResolvedValue(docs);
    getLearning.mockResolvedValue(content);
    render(<LearningsView />);
    await screen.findByText("the body");
    await userEvent.type(screen.getByPlaceholderText("Search learnings…"), "beta");
    // The list filters down (the content pane still shows the selected doc).
    const items = document.querySelectorAll(".learn-item");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Project Beta");
  });

  it("shows an empty state when the filter matches nothing", async () => {
    listLearnings.mockResolvedValue(docs);
    getLearning.mockResolvedValue(content);
    render(<LearningsView />);
    await screen.findByText("the body");
    await userEvent.type(screen.getByPlaceholderText("Search learnings…"), "zzz");
    expect(screen.getByText("No matching docs.")).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    listLearnings.mockRejectedValue(new Error("boom"));
    render(<LearningsView />);
    expect(await screen.findByText(/✗ Error: boom/)).toBeInTheDocument();
  });
});
