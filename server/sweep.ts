import { randomUUID } from "node:crypto";
import * as repo from "./repo.ts";
import { runClaude as runClaudeBin } from "./claude.ts";
import { listLearnings } from "./learnings.ts";
import { extractIssues, parseBriefToSections } from "./routines.ts";
import { enabledRoutines, getConfig, resolveRoutinePrompt } from "./config.ts";
import { refreshOpenPrs } from "./github-prs.ts";
import type {
  EditionTrigger,
  RoutineConfig,
  RoutineProgress,
  SweepIssue,
  SweepJob,
} from "../shared/types.ts";

const stripIssueLines = (md: string) =>
  md
    .split("\n")
    .filter((l) => !/^\s*>?\s*ISSUE:/i.test(l))
    .join("\n")
    .trim();

// In-memory job registry. Single-user local app — fine to keep in process.
const jobs = new Map<string, SweepJob>();

// Like the brain sweep, the morning routines pin a model rather than inherit
// the user's interactive default (often Opus) — multi-connector reasoning fits
// the mid tier; config-driven via models.reason.
// SWEEP_MOCK=1 returns a canned brief so the pipeline can be tested without a
// live multi-minute connector sweep; otherwise delegate to the shared runner.
function runClaude(prompt: string, extraEnv?: Record<string, string>): Promise<string> {
  if (process.env.SWEEP_MOCK === "1") {
    return Promise.resolve(MOCK_BRIEF);
  }
  return runClaudeBin(prompt, extraEnv, undefined, getConfig().models.reason);
}

// Epoch ms of the previous sweep — the "since last sweep" baseline. Falls back
// to 24h ago on the very first sweep (no prior edition).
function sweepSinceMs(): number {
  const prior = repo.latestEdition();
  if (prior) return Date.parse(prior.createdAt.replace(" ", "T") + "Z");
  return Date.now() - 24 * 60 * 60 * 1000;
}

// A highlight card for research docs added to ~/Projects/learnings since the
// last sweep. Pure data (mtime filter) — no LLM pass needed, unlike the
// connector/session routines. Returns null when nothing is new.
function freshLearningsSection(sinceMs: number): { title: string; bodyMd: string } | null {
  const fresh = listLearnings().filter((l) => l.mtime >= sinceMs);
  if (!fresh.length) return null;
  return {
    title: `Learnings — ${fresh.length} new since last sweep`,
    bodyMd: fresh
      .map((l) => `- **${l.title}**${l.date ? ` · ${l.date}` : ""} — \`${l.file}\``)
      .join("\n"),
  };
}

function timeLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Internal fields carried on the job (not in the public SweepJob shape): the
// trigger, and the snapshot of enabled routines this run iterates — captured at
// start so a mid-sweep config edit can't desync the progress list from the loop.
type SweepJobInternal = SweepJob & {
  trigger: EditionTrigger;
  routineList: RoutineConfig[];
};

async function execute(job: SweepJobInternal): Promise<void> {
  // Capture the previous sweep's time before this edition exists.
  const sinceMs = sweepSinceMs();
  const sinceEnv = { SWEEP_SINCE: new Date(sinceMs).toISOString() };
  repo.upsertDay({ date: job.date });
  const edition = repo.createEdition({
    date: job.date,
    label: job.label,
    trigger: job.trigger,
  });
  job.editionId = edition.id;

  const issues: SweepIssue[] = [];
  let sort = 0;
  for (let i = 0; i < job.routineList.length; i++) {
    const routine = job.routineList[i];
    job.routines[i].status = "running";
    let md: string;
    try {
      const prompt = resolveRoutinePrompt(routine.name).rendered;
      md = await runClaude(prompt, sinceEnv);
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      issues.push({ source: routine.name, message });
      repo.createSection({
        editionId: edition.id,
        date: job.date,
        source: "morning-brief",
        title: `${routine.name} — failed`,
        bodyMd: `Sweep error: ${message}`,
        sort: sort++,
      });
      job.routines[i].status = "failed";
      continue;
    }
    issues.push(...extractIssues(md));
    for (const s of parseBriefToSections(md)) {
      repo.createSection({
        editionId: edition.id,
        date: job.date,
        source: s.source,
        title: s.title,
        bodyMd: stripIssueLines(s.bodyMd),
        sort: sort++,
      });
    }
    job.routines[i].status = "done";
  }

  // Server-computed highlight: research docs added since the last sweep.
  const learnings = freshLearningsSection(sinceMs);
  if (learnings) {
    repo.createSection({
      editionId: edition.id,
      date: job.date,
      source: "learnings",
      title: learnings.title,
      bodyMd: learnings.bodyMd,
      sort: sort++,
    });
  }

  // Deterministic, no LLM: refresh the open-PRs set (the PRs tab) on the same
  // ~3x/day cadence. Failures (gh missing / not authed) are recorded as issues
  // and leave the last-known set intact — refreshOpenPrs only writes on success.
  // DAYBOARD_SKIP_PR_FETCH (set in the test setup) keeps the suite off the network.
  const skipPrFetch =
    process.env.SWEEP_MOCK === "1" || process.env.DAYBOARD_SKIP_PR_FETCH === "1";
  if (!skipPrFetch) {
    try {
      const n = refreshOpenPrs();
      console.log(`[sweep] refreshed ${n} open PRs`);
    } catch (e) {
      issues.push({ source: "github-prs", message: String(e instanceof Error ? e.message : e) });
    }
  }

  repo.setEditionIssues(edition.id, issues);
  job.status = "done";
}

export function startSweep(opts: {
  date: string;
  label?: string;
  trigger?: EditionTrigger;
}): SweepJob {
  const routineList = enabledRoutines();
  const routines: RoutineProgress[] = routineList.map((r) => ({
    name: r.name,
    label: r.label,
    status: "pending",
  }));
  const job: SweepJobInternal = {
    id: randomUUID(),
    status: "running",
    date: opts.date,
    label: opts.label ?? `Reset ${timeLabel()}`,
    trigger: opts.trigger ?? "manual",
    editionId: null,
    error: null,
    routines,
    routineList,
  };
  jobs.set(job.id, job);
  execute(job).catch((e) => {
    job.status = "error";
    job.error = String(e instanceof Error ? e.message : e);
  });
  return job;
}

// The sweep (if any) currently running for a date. Lets the day view advertise
// in-progress work to any page load, not just the tab that started the sweep.
export function getActiveSweep(date: string): SweepJob | null {
  for (const job of jobs.values()) {
    if (job.status === "running" && job.date === date) return job;
  }
  return null;
}

const MOCK_BRIEF = `# Morning brief — today

## Slack — needs a reply
- **#team** Someone asked for the launch timeline — [thread](https://example.com/1)
- **DM** quick question about the settings UI — [dm](https://example.com/2)

## Linear — assigned to you
- **ENG-214** Scope the integration launch (In Progress, P2) — [link](https://example.com/3)

## Notion — you were mentioned
- Nothing notable.

## Datadog — active incidents & alerts
- Nothing notable.

## Email — needs a reply
- A teammate wants the readiness summary before Friday — [thread](https://example.com/6)

## Calendar — today's schedule
- **9:30** Project sync (first meeting) — [meet](https://example.com/7)
- **11:00–12:30** Integration review (back-to-back with 12:30) — [meet](https://example.com/8)

## GitHub
**Assigned to you**
- web-app#4821 Account provisioning (open) — [pr](https://example.com/4)
**Review requested**
- api#1190 Database delegation seam (changes-requested) — [pr](https://example.com/5)
**Your open PRs**
- Nothing notable.
`;
