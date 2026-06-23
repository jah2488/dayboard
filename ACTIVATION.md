# dayboard — activation runbook

How to make dayboard always-on, schedule the morning sweep, and let Claude read/act on the
board over MCP. Default URL: `http://localhost:4747`.

> Once the server is owned by launchd (KeepAlive), don't run `npm start` by hand — it'll
> fight for the port. Manage it with `launchctl` (see bottom).

---

## Always-on + morning sweep (launchd, macOS)

1. Build the UI: `npm run build`
2. Install both LaunchAgents: `scripts/install-launchd.sh`
   - Custom time/port: `MORNING_HOUR=8 MORNING_MIN=30 PORT=4747 scripts/install-launchd.sh`
   - Or set the time live from **⚙ Settings → Sweep schedule** in the app.
3. Verify loaded: `launchctl list | grep dayboard` → `com.dayboard.server` (running) +
   `com.dayboard.morning`.
4. The server comes up on its own at `http://localhost:<PORT>`.
5. Test a real morning sweep: `bin/morning-run.sh` → a "Morning" edition appears.

The morning agent fires daily at the configured time (default 7:00 local). Logs:
`~/Library/Logs/dayboard/` (`server.log`, `morning.log`, `.err.log`).

Caveats:
- The machine must be **awake** at the fire time (launchd runs on wake if a fire was missed).
- To change the time later: re-run `scripts/install-launchd.sh` with env overrides, or use
  the Settings → Sweep schedule editor (it rewrites + reloads the agent in place).

## MCP server (Claude reads/acts on the board)

Register (user scope), pointing at this checkout:

```bash
claude mcp add dayboard -s user -- <repo>/node_modules/.bin/tsx <repo>/server/mcp.ts
claude mcp list      # → dayboard ✓ Connected
```

Tools: `get_day`, `list_tasks`, `create_task`, `complete_task`, `set_current_task`,
`delete_task`, `add_section`, `trigger_sweep`, `search_brain`, `get_brain_discoveries`,
`verify_discovery`, `trigger_brain_sweep`. The server must be running. A `state/today.json`
snapshot also refreshes on every change for direct file reads.

Try it: in any Claude session, "list my dayboard tasks" / "add a dayboard task: …".

## Connectors

GitHub flows into the brief through the **`gh` CLI** (must be authenticated with `repo` +
`read:org`), not an MCP connector — simplest path since the sweep runs locally. The
morning-brief prompt runs `gh search issues/prs` via Bash. Other sources (Slack, Linear,
Notion, Datadog, Gmail, Calendar, Granola) come from whatever MCP connectors are available
in the session; the sweep uses what's there and notes what's missing.

## Managing it later

- Status: `launchctl list | grep dayboard`
- Restart server: `launchctl kickstart -k gui/$(id -u)/com.dayboard.server`
- Run a morning sweep now: `bin/morning-run.sh` (or click ↻ New sweep in the UI)
- Stop / uninstall everything: `scripts/uninstall-launchd.sh`
- Remove MCP: `claude mcp remove dayboard -s user`
- Change morning time / port: re-run `scripts/install-launchd.sh` with env overrides
