Inventory {{identity.name}}'s local Claude Code sessions so unfinished threads can be picked back up. Output a SINGLE markdown message with the exact heading below (the dashboard splits cards by `##`, and routes any heading containing "session" to the Sessions card — keep the word "sessions" in it).

**Reporting failures (powers the dashboard alert panel):** if a step fails (e.g. `~/.claude/sessions` unreadable, `jq` missing), add one line in EXACTLY this form: `ISSUE: Claude sessions — <one-line reason>`, then write what you can and move on. Do NOT emit ISSUE for "nothing to report".

## How to gather

1. **List session state files.** Each live/recent CLI session writes `~/.claude/sessions/<pid>.json`:
   `{ pid, sessionId, cwd, status (idle|waiting|busy|…), waitingFor, kind, entrypoint, startedAt, updatedAt }`
   (`updatedAt`/`startedAt` are epoch ms.) Read them with Bash + `jq`.

2. **Keep only interactive CLI sessions** — `kind == "interactive"`. Skip headless/print sessions (the dashboard's own sweep runs, this routine included — self-referential noise) and skip malformed files with no `updatedAt` or a null `status`.

3. **Liveness — guard against PID reuse.** A session is *running now* only if its `pid` is alive AND that process is actually a Claude process: `ps -p <pid> -o command= 2>/dev/null | grep -qi claude`. A live PID whose command isn't Claude has been recycled by the OS → treat as *closed*. Note: a session that's been `idle` for many hours but is still alive is a genuine "left open" thread — surface it (that's the point of this card), with its idle age called out.

4. **Window for closed sessions:** the env var `SWEEP_SINCE` (ISO timestamp) marks the previous sweep. Include a *closed* session only if its `updatedAt` is at/after `SWEEP_SINCE`. If `SWEEP_SINCE` is unset/empty, fall back to the last 24 hours. *Running* sessions are always included regardless of the window.

5. **Summarize each surfaced session.** Find its transcript via the glob `~/.claude/projects/*/<sessionId>.jsonl` (don't reconstruct the directory name; guard the glob so a no-match doesn't error — e.g. `ls … 2>/dev/null`). Read the tail (e.g. `tail -c 20000`) and distill ONE line: what the session was working on and whether it looks mid-task / left hanging. If no transcript is found, say "no transcript" and use the cwd.

6. **Cap + dedupe:** at most ~8 entries per group, most-recently-active first. Collapse multiple sessions in the same `cwd` only if they're clearly the same thread.

## Output format

```
## Claude sessions — open threads
**Running now**
- **<project folder name>** — <status>{, waiting on <waitingFor>} · active <relative time> — <one-line what it's doing / left at>
**Closed since last sweep**
- **<project folder name>** — closed <relative time> — <one-line what it was about / where it stopped>

_Local CLI sessions only — desktop/web chats aren't tracked here._
```

Use the last path segment of `cwd` as the project name (e.g. `~/Projects/my-app` → `my-app`). Show times relative to now (e.g. "12m ago", "2h ago"). If a group is empty, write "Nothing notable." under its bold label. Keep each bullet to one line; no transcript quotes, just a plain-language summary.
