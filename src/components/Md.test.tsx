// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown, MdInline } from "./Md";

describe("Markdown", () => {
  it("renders block markdown and forces links to a new tab", () => {
    render(<Markdown>{"# Heading\n\n[link](https://example.com)"}</Markdown>);
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    const a = screen.getByRole("link", { name: "link" });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noreferrer");
  });
});

describe("MdInline", () => {
  it("renders a paragraph as an inline span, not a block <p>", () => {
    const { container } = render(<MdInline>{"**bold** text"}</MdInline>);
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("span")).not.toBeNull();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });
});
