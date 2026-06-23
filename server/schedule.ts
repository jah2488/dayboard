import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Live control of the morning-sweep launchd agent (macOS). The agent is created
// once by scripts/install-launchd.sh; this rewrites its fire time in place and
// reloads it, so the admin panel's schedule editor actually takes effect.
//
// Label must match the installer's. The plist is edited surgically (just the
// StartCalendarInterval integers) so we don't have to re-resolve binary paths.

export const MORNING_LABEL = "com.dayboard.morning";

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${MORNING_LABEL}.plist`);
}

export interface ScheduleResult {
  applied: boolean; // true if the launchd agent was rewritten + reloaded
  detail: string;
}

// Rewrite the agent's fire time and reload it. Returns applied:false (not an
// error) when the agent isn't installed yet — the caller has already persisted
// the preference to config, so it'll take effect at next install.
export function applySchedule(hour: number, minute: number): ScheduleResult {
  const path = plistPath();
  if (!existsSync(path)) {
    return {
      applied: false,
      detail:
        "Saved. The morning agent isn't installed yet — run scripts/install-launchd.sh to activate it.",
    };
  }

  const original = readFileSync(path, "utf8");
  const rewritten = original
    .replace(/(<key>Hour<\/key>\s*<integer>)\d+(<\/integer>)/, `$1${hour}$2`)
    .replace(/(<key>Minute<\/key>\s*<integer>)\d+(<\/integer>)/, `$1${minute}$2`);
  if (rewritten === original) {
    return {
      applied: false,
      detail: "Saved, but couldn't find the schedule fields in the launchd plist to rewrite.",
    };
  }
  writeFileSync(path, rewritten);

  const domain = `gui/${process.getuid?.() ?? ""}`;
  try {
    // bootout is a no-op (and errors) if it isn't currently loaded — ignore.
    try {
      execFileSync("launchctl", ["bootout", `${domain}/${MORNING_LABEL}`], { stdio: "ignore" });
    } catch {
      /* not loaded — fine */
    }
    execFileSync("launchctl", ["bootstrap", domain, path], { stdio: "ignore" });
  } catch (e) {
    return {
      applied: false,
      detail: `Saved + plist updated, but reload failed: ${String(
        e instanceof Error ? e.message : e,
      )}. It'll apply on next login.`,
    };
  }
  return {
    applied: true,
    detail: `Morning sweep rescheduled to ${hour}:${String(minute).padStart(2, "0")} and reloaded.`,
  };
}
