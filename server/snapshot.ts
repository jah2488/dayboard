import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildDayView } from "./views.ts";
import { localDate } from "./util.ts";

// File-based read hook: a snapshot of today that Claude (or anything) can read
// directly without the HTTP API or MCP. Refreshed on startup and after each
// mutating API call.
// DAYBOARD_STATE_DIR keeps test runs from overwriting the real state/today.json
// that the running app and Claude read.
const stateDir =
  process.env.DAYBOARD_STATE_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "state");

export function writeSnapshot(): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    const today = localDate();
    writeFileSync(
      join(stateDir, "today.json"),
      JSON.stringify(buildDayView(today), null, 2),
    );
  } catch {
    // Snapshot is best-effort; never break a request because of it.
  }
}
