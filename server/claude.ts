import { execFile } from "node:child_process";

// Headless `claude` runner shared by the sweep routines and the Sessions tab's
// on-demand summarizer. The sweep is a trusted, read-only local routine, so it
// runs with approval gates off (bypassPermissions) so one click runs the full
// sweep with no prompts. Tighten via env if you prefer, e.g.
// SWEEP_CLAUDE_ARGS="-p --allowedTools mcp__slack__...".
const CLAUDE_BIN = process.env.SWEEP_CLAUDE_BIN ?? "claude";
const CLAUDE_ARGS = (
  process.env.SWEEP_CLAUDE_ARGS ?? "-p --permission-mode bypassPermissions"
).split(" ");
const TIMEOUT_MS = Number(process.env.SWEEP_TIMEOUT_MS ?? 300_000);

// The shared Claude account hits a usage/rate limit during the sweep's many
// sequential research calls; the limit message prints to STDOUT, not stderr.
// Callers use this to DEFER (retry next sweep) rather than record a failure.
export function isUsageLimitError(text: string): boolean {
  return /usage limit|rate limit|limit reached|resets? at|quota|overloaded/i.test(text);
}

// Background sweeps must pin a model: with no --model, `claude -p` inherits the
// user's interactive default (often Opus), so dozens of automated calls per
// sweep burn daily usage. Callers pass a cheap tier explicitly.
export function claudeArgs(prompt: string, model?: string): string[] {
  return [...CLAUDE_ARGS, ...(model ? ["--model", model] : []), prompt];
}

export function runClaude(
  prompt: string,
  extraEnv?: Record<string, string>,
  timeoutMs = TIMEOUT_MS,
  model?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLAUDE_BIN,
      claudeArgs(prompt, model),
      {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      },
      (err, stdout, stderr) => {
        if (err) {
          // A kill (timeout/signal) is reported honestly and on its own.
          if (err.killed) {
            return reject(new Error(`claude killed (timeout ${timeoutMs}ms or signal)`));
          }
          // Prefer what claude actually PRINTED (stderr, then stdout — the
          // usage-limit notice lands on stdout) so callers can grep it via
          // isUsageLimitError; only fall back to err.message (which echoes the
          // whole command + prompt) when the process produced no output at all.
          const detail = [stderr?.trim(), stdout?.trim()].filter(Boolean).join(" — ");
          return reject(new Error(detail || err.message));
        }
        resolve(stdout);
      },
    );
    // claude -p takes the prompt as an argument; without this it waits ~3s
    // for piped stdin on every call and logs a warning into stderr.
    child.stdin?.end();
  });
}
