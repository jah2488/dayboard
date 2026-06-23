import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "@testing-library/jest-dom/vitest";

// Point the DB + snapshot + learnings dir at a throwaway location per worker
// BEFORE any server module (db.ts/learnings.ts read these at import time) loads.
// Keeps tests from clobbering ./data / ./state or reading the real ~/Projects/learnings.
if (!process.env.DAYBOARD_DATA_DIR) {
  const base = mkdtempSync(join(tmpdir(), "dayboard-test-"));
  process.env.DAYBOARD_DATA_DIR = base;
  process.env.DAYBOARD_STATE_DIR = base;
  const learnings = join(base, "learnings");
  mkdirSync(learnings, { recursive: true });
  process.env.LEARNINGS_DIR = learnings;
}

// sweep.ts captures the claude binary name at import. Pin it to something that
// can't exist so a non-mocked sweep deterministically hits the failure path
// (never the real `claude`). Mocked sweeps short-circuit before exec.
process.env.SWEEP_CLAUDE_BIN ??= "dayboard-no-such-binary";

// The PRs-tab refresh shells out to `gh`. Disable it suite-wide so no test
// touches the network — the failure-path test deletes SWEEP_MOCK to force a
// real exec, so that flag alone wouldn't cover it.
process.env.DAYBOARD_SKIP_PR_FETCH ??= "1";
