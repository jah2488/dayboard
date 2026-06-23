Generate {{identity.name}}'s morning brief for today. Keep it scannable — short sections, plain prose under each heading, no fluff. If a section has nothing, write "Nothing notable." rather than omitting it.

Use the available MCP connectors in parallel where possible. Use whatever Slack, Linear, Notion, Datadog, Gmail, Calendar, and Granola MCP tools are available in this session (match on tool-name patterns, e.g. `*slack*`, `*linear*`, `*notion*`, `*datadog*`, `*gmail*`, `*calendar*`, `*granola*`). GitHub comes from the `gh` CLI via Bash (see section 5). If a connector has no tools available this run, write a one-line note under its section and move on. Drop any section whose connector you don't use.

**Reporting failures (powers the dashboard alert panel):** whenever a connector is missing/unreachable/lost mid-run, returns an auth error, or a fetch (calendar, GitHub, etc.) fails, add a line in that section in EXACTLY this form: `ISSUE: <Source> — <one-line reason>` (e.g. `ISSUE: GitHub — gh CLI not authenticated`, `ISSUE: Datadog — connector lost connection`). One ISSUE line per failed source. Still write the normal section note too. Do NOT emit ISSUE for a source that simply had nothing to report.

1. **Slack** — DMs and @mentions from the last ~24 hours that look like they need a response. Surface the sender, channel/DM, a one-line summary, and a link. Skip noise (bot messages, FYI broadcasts, threads already replied to). Optionally surface 1–2 threads that seem important but easy to miss.

2. **Linear** — two buckets, each its own bold sub-label in the output:
   - **Assigned to you**: open issues assigned to you (assignee = me, status not done/canceled). Highlight anything due today, overdue, or urgent/high priority (P1/P2). Include identifier (e.g. ENG-1234), title, status, and link.
   - **Watching**: any other open issues worth tracking (teams or projects you follow). One line each: identifier, title, status, link. Read-only, surface only.

3. **Notion** — Pages or comments where you were mentioned/tagged recently. Show page title, who tagged you, a snippet, and the link.

4. **Datadog** — Active incidents and any P1/P2 alerts or monitors currently alerting. Filter to your teams/services if possible; otherwise show all active ones. Include a link each.

5. **GitHub** — via the `gh` CLI (already authenticated). Run these with Bash and parse the JSON; three buckets, each its own subsection:
   - **Assigned to you**: `gh search issues --assignee=@me --state=open --limit=20 --json repository,number,title,url,state,isPullRequest` (covers both issues and PRs).
   - **Review requested**: `gh search prs --review-requested=@me --state=open --limit=20 --json repository,number,title,url,isDraft`.
   - **Your open PRs**: `gh search prs --author=@me --state=open --limit=20 --json repository,number,title,url,isDraft` — for any that look active, you may check review/CI state with `gh pr view <url> --json reviewDecision,statusCheckRollup,isDraft`.
   For each item: repo, number, title, status (draft / changes-requested / checks-failing where known), and a clickable link. If a `gh` command errors (e.g. not authed), write one line saying so and move on.

6. **Email** — via the Gmail MCP connector (match `*gmail*` tools). Surface unread or recent (last ~24h) threads that look like they need a response. For each: sender, a one-line summary of what they want, and a link to the thread. Skip newsletters, automated notifications, marketing, and threads already replied to. Prefer threads where you are a direct recipient over CC/list mail. If there's nothing actionable, write "Nothing notable."

7. **Calendar** — via the Calendar MCP connector (match `*calendar*` tools). List today's events in chronological order: start time (your local time), title, and — if present — meeting link and other attendees. Flag the first meeting of the day and call out any back-to-back stretches or conflicts/overlaps. Skip all-day informational blocks unless they need action. If the day is clear, write "Nothing on the calendar today."

8. **Meetings (Granola)** — via the Granola MCP connector (match `*granola*` tools). Surface notes from meetings in roughly the last 24h. For each: meeting title, date, and one or two lines of decisions, action items, or new asks that came out of it. Read-only: do not create or modify anything anywhere. If there is nothing recent, write "Nothing notable."

**Output format** — render as a SINGLE markdown message. Use exactly this structure (the dashboard splits it into cards by the `##` headings, so keep them verbatim):

```
# Morning brief — {today's date, e.g. Monday May 25}

## Slack — needs a reply
- ...

## Linear — your issues & watching
**Assigned to you**
- ...
**Watching**
- ...

## Notion — you were mentioned
- ...

## Datadog — active incidents & alerts
- ...

## Email — needs a reply
- ...

## Calendar — today's schedule
- ...

## Meetings — recent notes & asks
- ...

## GitHub
**Assigned to you**
- ...
**Review requested**
- ...
**Your open PRs**
- ...
```

Keep each bullet to one line where possible. Always include clickable links. Cite sources for everything — don't editorialize, just surface what's there. If a connector errors out, say so under that section in one line and move on.
