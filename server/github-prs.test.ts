import { describe, it, expect } from "vitest";
import {
  ciStatus,
  extractTickets,
  extractBlockedBy,
  reviewChannel,
  deriveFlagsAndNote,
  ageDays,
  buildRow,
} from "./github-prs.ts";

describe("ciStatus", () => {
  it("returns none for empty/missing rollup", () => {
    expect(ciStatus(null)).toBe("none");
    expect(ciStatus([])).toBe("none");
  });
  it("fail dominates", () => {
    expect(ciStatus([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }])).toBe("fail");
  });
  it("pending when something is in flight and nothing failed", () => {
    expect(ciStatus([{ conclusion: "SUCCESS" }, { state: "PENDING" }])).toBe("pending");
    expect(ciStatus([{ conclusion: null }])).toBe("pending");
  });
  it("pass when everything succeeded", () => {
    expect(ciStatus([{ conclusion: "SUCCESS" }, { state: "SUCCESS" }])).toBe("pass");
  });
  it("none when only neutral/skipped", () => {
    expect(ciStatus([{ conclusion: "NEUTRAL" }, { conclusion: "SKIPPED" }])).toBe("none");
  });
});

describe("extractTickets", () => {
  it("pulls keys from title and body, deduped", () => {
    expect(
      extractTickets("denormalize org id [GTM-626]", "follow-up to GTM-622. Linear: AB-4962, AB-4962"),
    ).toEqual(["GTM-626", "GTM-622", "AB-4962"]);
  });
  it("handles PARTNER-190 / SOL-107 style", () => {
    expect(extractTickets("Add index (PARTNER-190)", "branch feat/sol-107")).toEqual(["PARTNER-190"]);
  });
  it("returns empty when none present", () => {
    expect(extractTickets("just a title", "no keys here")).toEqual([]);
  });
});

describe("extractBlockedBy", () => {
  it("captures dependency phrasing", () => {
    expect(extractBlockedBy("This depends on #21755 landing first")).toEqual(["#21755"]);
    expect(extractBlockedBy("paired with web-app#9234")).toEqual(["#9234"]);
    expect(extractBlockedBy("blocked by #1 and requires #2")).toEqual(["#1", "#2"]);
  });
  it("ignores unrelated # references", () => {
    expect(extractBlockedBy("see #500 for context")).toEqual([]);
  });
});

// A self-contained github config so the routing logic is tested independent of
// any one org's real channel map (which lives in the user's data/config.json).
const TEST_GH = {
  org: "acme",
  defaultChannel: "#code-review",
  repoChannels: {
    infra: { channel: "#team-infra", verified: true },
    "api-spec": { channel: "#team-api", verified: true },
    admin: { channel: "#team-ops", verified: false },
    tooling: { channel: "#team-tools", verified: false },
  },
  repoKeywordRules: {
    monolith: [
      { keywords: ["billing", "invoice", "usage"], channel: "#team-billing" },
      { keywords: ["frontend", "deploy", "page"], channel: "#team-web" },
    ],
  },
};

describe("reviewChannel", () => {
  it("maps a configured repo to its channel (verified)", () => {
    expect(reviewChannel("infra", "", "", TEST_GH)).toEqual({
      channel: "#team-infra",
      verified: true,
    });
    expect(reviewChannel("api-spec", "", "", TEST_GH)).toEqual({
      channel: "#team-api",
      verified: true,
    });
  });
  it("routes a keyworded repo by area, first matching rule wins", () => {
    expect(reviewChannel("monolith", "invoice billing flag", "", TEST_GH).channel).toBe(
      "#team-billing",
    );
    expect(reviewChannel("monolith", "frontend deploy page", "", TEST_GH).channel).toBe(
      "#team-web",
    );
    // no keyword match -> falls through to the default channel
    expect(reviewChannel("monolith", "tweak the scheduler", "", TEST_GH).channel).toBe(
      "#code-review",
    );
    // whole-word, not substring: "page" must not fire on "pagination"
    expect(reviewChannel("monolith", "rework pagination logic", "", TEST_GH).channel).toBe(
      "#code-review",
    );
  });
  it("marks mappings flagged unverified, and the default fallback, as unverified", () => {
    expect(reviewChannel("admin", "", "", TEST_GH).verified).toBe(false);
    expect(reviewChannel("tooling", "", "", TEST_GH).verified).toBe(false);
    expect(reviewChannel("unknown-repo", "", "", TEST_GH).verified).toBe(false);
  });
});

describe("deriveFlagsAndNote", () => {
  const base = {
    isDraft: false,
    reviewDecision: null as string | null,
    mergeable: "MERGEABLE" as string | null,
    mergeState: "CLEAN" as string | null,
    ci: "pass" as const,
    blockedBy: [] as string[],
  };

  it("conflicts lead the note", () => {
    const r = deriveFlagsAndNote({ ...base, mergeable: "CONFLICTING", mergeState: "DIRTY" });
    expect(r.flags).toContain("conflicts");
    expect(r.note).toMatch(/^Merge conflicts/);
  });
  it("behind + failing CI combine", () => {
    const r = deriveFlagsAndNote({ ...base, mergeState: "BEHIND", ci: "fail" });
    expect(r.flags).toEqual(expect.arrayContaining(["behind", "failing CI"]));
    expect(r.note.toLowerCase()).toContain("behind main");
    expect(r.note.toLowerCase()).toContain("failing ci");
  });
  it("a plain draft says so", () => {
    const r = deriveFlagsAndNote({ ...base, isDraft: true });
    expect(r.flags).toContain("draft");
    expect(r.note).toBe("Draft — mark ready when set.");
  });
  it("a ready PR needing review", () => {
    const r = deriveFlagsAndNote({ ...base, reviewDecision: "REVIEW_REQUIRED" });
    expect(r.note).toBe("Awaiting review.");
  });
  it("blocked-by surfaces in the note", () => {
    const r = deriveFlagsAndNote({ ...base, blockedBy: ["#21755"] });
    expect(r.note).toContain("#21755");
  });
  it("a draft that also depends keeps the dependency visible", () => {
    const r = deriveFlagsAndNote({ ...base, isDraft: true, blockedBy: ["#100"] });
    expect(r.note).toContain("#100");
  });
});

describe("ageDays", () => {
  it("floors elapsed days", () => {
    const now = Date.parse("2026-06-15T12:00:00Z");
    expect(ageDays("2026-06-15T00:00:00Z", now)).toBe(0);
    expect(ageDays("2026-06-10T00:00:00Z", now)).toBe(5);
    expect(ageDays("2026-05-05T11:00:00Z", now)).toBe(41);
  });
  it("never negative; 0 on garbage", () => {
    const now = Date.parse("2026-06-15T12:00:00Z");
    expect(ageDays("2099-01-01T00:00:00Z", now)).toBe(0);
    expect(ageDays("not-a-date", now)).toBe(0);
  });
});

describe("buildRow", () => {
  it("assembles a persistable row end to end", () => {
    const row = buildRow(
      {
        number: 22084,
        title: "Add org flag for usage notifications",
        url: "https://github.com/acme/monolith/pull/22084",
        createdAt: "2026-06-15T17:44:00Z",
        isDraft: true,
        body: "Ticket: AB-4962. Blocks #1922.",
        repository: { name: "monolith", nameWithOwner: "acme/monolith" },
      },
      {
        reviewDecision: "REVIEW_REQUIRED",
        mergeable: "MERGEABLE",
        mergeStateStatus: "BEHIND",
        statusCheckRollup: [{ conclusion: "FAILURE" }, { conclusion: "SUCCESS" }],
      },
      TEST_GH,
    );
    expect(row.repo).toBe("monolith");
    expect(row.stateLabel).toBe("Draft");
    expect(row.ci).toBe("fail");
    expect(row.tickets).toEqual(["AB-4962"]);
    expect(row.reviewChannel).toBe("#team-billing"); // "usage" keyword routed
    expect(row.channelVerified).toBe(true);
    expect(row.flags).toEqual(expect.arrayContaining(["draft", "behind", "failing CI"]));
  });
});
