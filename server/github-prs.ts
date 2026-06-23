import { execFileSync } from "node:child_process";
import * as repo from "./repo.ts";
import { getConfig } from "./config.ts";
import type { DayboardConfig, OpenPr, PrCi } from "../shared/types.ts";

// Open PRs the user authored across an org, refreshed deterministically (no
// LLM) on each sweep. The `gh` CLI is already authenticated on the host; we
// shell out, enrich in pure code, and replace the whole github_prs table.
//
// Scope is authored-by-me + open + one org (config github.org). The
// morning-brief routine keeps the assigned / review-requested buckets — this is
// the dedicated "my PRs" view.

// ---- gh shapes (only the fields we read) ----

interface SearchPr {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  isDraft: boolean;
  body: string;
  repository: { name: string; nameWithOwner: string };
}

interface RollupItem {
  // CheckRun carries `conclusion`; StatusContext carries `state`.
  conclusion?: string | null;
  state?: string | null;
}
interface PrDetail {
  reviewDecision: string | null;
  mergeable: string | null;
  mergeStateStatus: string | null;
  statusCheckRollup: RollupItem[] | null;
}

// A fully enriched row, ready to persist. (DB read/write lives in repo.ts.)
export type PrRow = Omit<OpenPr, "ageDays">;

// ---- pure enrichment (unit-tested; no IO) ----

// Reduce the mixed check-run / status-context rollup to one signal.
export function ciStatus(rollup: RollupItem[] | null | undefined): PrCi {
  if (!rollup || rollup.length === 0) return "none";
  const states = rollup.map((r) => (r.conclusion ?? r.state ?? "").toUpperCase());
  if (states.some((s) => s === "FAILURE" || s === "ERROR" || s === "TIMED_OUT" || s === "CANCELLED")) return "fail";
  if (states.some((s) => s === "" || s === "PENDING" || s === "IN_PROGRESS" || s === "QUEUED" || s === "EXPECTED")) return "pending";
  if (states.some((s) => s === "SUCCESS")) return "pass";
  return "none"; // only NEUTRAL/SKIPPED
}

// Ticket keys like AB-4962, GTM-626, PARTNER-190, SOL-107 from title + body.
export function extractTickets(title: string, body: string): string[] {
  const re = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
  const out = new Set<string>();
  for (const text of [title, body]) {
    for (const m of (text ?? "").matchAll(re)) out.add(m[1]);
  }
  return [...out];
}

// PR numbers this one is gated on, from "depends on / blocked by / paired with
// / after / requires … #N" phrasing in the body.
export function extractBlockedBy(body: string): string[] {
  const re = /(?:depends on|blocked by|blocked on|paired with|requires|after)\b[^#\n]{0,40}#(\d+)/gi;
  const out = new Set<string>();
  for (const m of (body ?? "").matchAll(re)) out.add(`#${m[1]}`);
  return [...out];
}

// Slack review channel for a repo, resolved from config (github.repoChannels +
// optional per-repo keyword routing for monorepos). A keyword rule wins first
// (verified), then a direct mapping, then the default channel (unverified, so
// the UI can show "verify"). Pure: the github config is injected, so the
// routing logic is unit-tested independent of any one org's data.
export function reviewChannel(
  repoName: string,
  title: string,
  body: string,
  gh: DayboardConfig["github"] = getConfig().github,
): { channel: string; verified: boolean } {
  const rules = gh.repoKeywordRules[repoName];
  if (rules?.length) {
    const haystack = `${title} ${body}`.toLowerCase();
    // Whole-word match (not substring): "account" must not fire on "accountant",
    // "page" not on "pagination". Keywords are config-supplied, so escape them.
    const hasWord = (k: string) =>
      new RegExp(`\\b${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack);
    for (const rule of rules) {
      if (rule.keywords.some(hasWord)) {
        return { channel: rule.channel, verified: true };
      }
    }
  }
  const mapped = gh.repoChannels[repoName];
  if (mapped) return { channel: mapped.channel, verified: mapped.verified };
  return { channel: gh.defaultChannel, verified: false };
}

// Short status flags + a one-line "why open beyond review" note, derived from
// the merge/CI/review signals. Order matters: hard blockers lead the note.
export function deriveFlagsAndNote(input: {
  isDraft: boolean;
  reviewDecision: string | null;
  mergeable: string | null;
  mergeState: string | null;
  ci: PrCi;
  blockedBy: string[];
}): { flags: string[]; note: string } {
  const conflicts = input.mergeable === "CONFLICTING" || input.mergeState === "DIRTY";
  const behind = input.mergeState === "BEHIND";
  const failingCi = input.ci === "fail";
  const pendingCi = input.ci === "pending";
  const changesRequested = input.reviewDecision === "CHANGES_REQUESTED";
  const needsReview =
    !input.isDraft && (input.reviewDecision === "REVIEW_REQUIRED" || !input.reviewDecision);

  const flags: string[] = [];
  if (input.isDraft) flags.push("draft");
  if (conflicts) flags.push("conflicts");
  if (behind) flags.push("behind");
  if (failingCi) flags.push("failing CI");
  if (pendingCi) flags.push("CI running");
  if (changesRequested) flags.push("changes requested");
  if (input.blockedBy.length) flags.push(`blocked by ${input.blockedBy.join(", ")}`);

  // Note: lead with the most actionable blocker.
  let lead = "";
  if (conflicts) lead = "Merge conflicts — rebase before it can be reviewed.";
  else if (behind || failingCi) {
    const parts = [behind && "behind main", failingCi && "failing CI"].filter(Boolean);
    lead = `${parts.join(" + ")} — rebase & clear CI before marking ready.`;
    lead = lead.charAt(0).toUpperCase() + lead.slice(1);
  } else if (changesRequested) lead = "Changes requested — address review feedback.";
  else if (input.blockedBy.length) lead = `Blocked by ${input.blockedBy.join(", ")} — land that first.`;
  else if (input.isDraft) lead = "Draft — mark ready when set.";
  else if (needsReview) lead = "Awaiting review.";
  else lead = "Open.";

  // A draft that also depends on another PR: keep the dependency visible.
  if (input.isDraft && input.blockedBy.length && !lead.startsWith("Blocked")) {
    lead += ` Depends on ${input.blockedBy.join(", ")}.`;
  }
  return { flags, note: lead };
}

export function ageDays(createdAtIso: string, now = Date.now()): number {
  const t = Date.parse(createdAtIso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

// Assemble a persistable row from the search hit + per-PR detail. Pure.
export function buildRow(
  pr: SearchPr,
  detail: PrDetail,
  gh: DayboardConfig["github"] = getConfig().github,
): PrRow {
  const ci = ciStatus(detail.statusCheckRollup);
  const blockedBy = extractBlockedBy(pr.body);
  const { channel, verified } = reviewChannel(pr.repository.name, pr.title, pr.body, gh);
  const { flags, note } = deriveFlagsAndNote({
    isDraft: pr.isDraft,
    reviewDecision: detail.reviewDecision,
    mergeable: detail.mergeable,
    mergeState: detail.mergeStateStatus,
    ci,
    blockedBy,
  });
  return {
    repo: pr.repository.name,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    isDraft: pr.isDraft,
    stateLabel: pr.isDraft ? "Draft" : "Ready",
    reviewDecision: detail.reviewDecision,
    mergeState: detail.mergeStateStatus,
    mergeable: detail.mergeable,
    ci,
    flags,
    reviewChannel: channel,
    channelVerified: verified,
    tickets: extractTickets(pr.title, pr.body),
    blockedBy,
    note,
    createdAt: pr.createdAt,
    fetchedAt: new Date().toISOString(),
  };
}

// ---- gh IO (not unit-tested; exercised manually / in the sweep) ----

function gh(args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  });
}

function fetchSearch(org: string): SearchPr[] {
  const out = gh([
    "search", "prs",
    "--author=@me", "--state=open", `--owner=${org}`,
    "--limit=100",
    "--json", "number,title,url,repository,createdAt,isDraft,body",
  ]);
  return JSON.parse(out) as SearchPr[];
}

function fetchDetail(url: string): PrDetail {
  const out = gh([
    "pr", "view", url,
    "--json", "reviewDecision,mergeable,mergeStateStatus,statusCheckRollup",
  ]);
  return JSON.parse(out) as PrDetail;
}

// Refresh the whole set. Builds all rows BEFORE touching the DB so a `gh`
// failure leaves the last-known set intact (the page never blanks on error).
// Returns the number of PRs stored. Throws on gh/auth failure. No-ops (and
// clears the set) when no org is configured — the PRs tab then shows empty.
export function refreshOpenPrs(): number {
  const org = getConfig().github.org;
  if (!org) {
    repo.replaceGithubPrs([]);
    return 0;
  }
  const search = fetchSearch(org);
  const rows = search.map((pr) => buildRow(pr, fetchDetail(pr.url)));
  repo.replaceGithubPrs(rows);
  return rows.length;
}

export function listOpenPrs(now = Date.now()): OpenPr[] {
  return repo.listGithubPrs().map((r) => ({ ...r, ageDays: ageDays(r.createdAt, now) }));
}
