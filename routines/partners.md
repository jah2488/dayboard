Produce a READ-ONLY snapshot of a Notion database for {{identity.name}}'s dashboard. This is a display-only card — do NOT modify anything.

> Example routine. Point it at your own Notion database (set the data source id below) and adjust the columns/output to match. Disabled by default — enable it in Settings once configured. The full, personalized version lives in your local override (Settings → Sweep prompts).

STRICT RULES:
- READ ONLY. Do not create, update, or delete any Notion page/row. Do not send any message. Do not edit anything anywhere. If you are about to call a write/update/create tool, stop — that is out of scope.

WHAT TO READ:
- Notion data source: `collection://REPLACE_WITH_YOUR_DATA_SOURCE_ID`
- Columns (example): a title column, a Stage, a Priority (P0/P1/P2), a 'Next action', a 'Needs triage' (checkbox), a Source (url), and Updated.

WHAT TO OUTPUT — a single markdown message in EXACTLY this shape (the dashboard splits cards on the `##` heading, so keep it verbatim):

```
# Tracker

## Tracker — needs triage & active
**Needs triage**
- [**{Title}**]({Notion page url}) — {What's needed}. Next: {Next action}

**Active (P0/P1)**
- [**{Title}**]({Notion page url}) — {Stage}, {Priority}. Next: {Next action}
```

FORMATTING:
- Always link the title to its Notion page URL (use the page's url from the fetch); if missing, link to the Source url; if neither, leave it bold with no link.
- Lead with the **Needs triage** items (checkbox = true). If none, write "- Nothing needs triage."
- Under **Active (P0/P1)**, list only P0/P1 rows not Done/Blocked, sorted P0 first. Keep each to one line.
- Plain, lean wording. No editorializing. If Notion is unreachable, output the heading and one line: "- Notion unreachable this run." AND a line in this exact form for the dashboard alert panel: `ISSUE: Notion — tracker unreachable`. Never fail silently.
