import { describe, expect, it } from "vitest";
import { claudeArgs, isUsageLimitError } from "./claude.ts";

describe("claudeArgs", () => {
  it("appends --model before the prompt when a model is pinned", () => {
    const args = claudeArgs("hello", "haiku");
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("haiku");
    expect(args.at(-1)).toBe("hello"); // prompt stays last
  });

  it("omits --model when none is given (inherits the CLI default)", () => {
    expect(claudeArgs("hello")).not.toContain("--model");
  });
});

describe("isUsageLimitError", () => {
  it("matches the usage-limit notices claude prints", () => {
    expect(isUsageLimitError("Claude usage limit reached. Resets at 9pm")).toBe(true);
    expect(isUsageLimitError("rate limit exceeded")).toBe(true);
    expect(isUsageLimitError("Internal server error")).toBe(false);
  });
});
