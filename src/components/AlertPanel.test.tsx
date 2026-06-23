// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertPanel } from "./AlertPanel";

describe("AlertPanel", () => {
  it("renders nothing when there are no issues", () => {
    const { container } = render(<AlertPanel issues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("singularizes the count for one issue", () => {
    render(<AlertPanel issues={[{ source: "GitHub", message: "gh not authed" }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("1 issue during the last sweep");
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("gh not authed")).toBeInTheDocument();
  });

  it("pluralizes the count for multiple issues", () => {
    render(
      <AlertPanel
        issues={[
          { source: "GitHub", message: "a" },
          { source: "Calendar", message: "b" },
        ]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("2 issues during the last sweep");
  });
});
