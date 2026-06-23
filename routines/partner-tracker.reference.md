# Tracker maintenance — REFERENCE EXAMPLE (not run by dayboard)

This is an **example** of a write/maintenance routine you might run *outside*
dayboard (e.g. as a scheduled remote routine on claude.ai) to keep a Notion
database current. dayboard does NOT execute this — it's documentation showing
the pattern. The read-only companion that surfaces the DB as a dashboard card is
`routines/partners.md`.

> Why it isn't a dayboard sweep routine: it **writes** (updates Notion, sends a
> message), so running it on every "New sweep" click would re-run maintenance
> repeatedly. Keep write/maintenance work on its own schedule; let dayboard only
> *read* and render. To surface results in dayboard, enable the read-only
> `partners` routine (Settings → Sweep prompts) pointed at the same DB.

Suggested setup for the external routine:
- Schedule: a few times a day (e.g. `0 13,17,22 * * *` UTC).
- Connectors: Gmail, Slack, Notion, Linear, Calendar, plus a meeting-notes tool.
- Notion data source: `collection://REPLACE_WITH_YOUR_DATA_SOURCE_ID`.

---

## Example prompt

You maintain a Notion database that tracks ongoing relationships or projects.
Keep entries clean and report-ready — the DB may be shared with others.

THE DATABASE
- Notion data source: `collection://REPLACE_WITH_YOUR_DATA_SOURCE_ID`
- Columns (example): Title, Stage (Triage → Scoping → Prototyping → Readiness →
  POC → Commercial → Live, with Blocked as an off-ramp), Priority (P0/P1/P2),
  Lead, 'What they need' (text), 'Next action' (text), 'Needs triage' (checkbox),
  Source (url), Updated (auto).

EACH RUN, DO THIS:
0. ANCHOR TODAY'S DATE. Run `date -u` with Bash first and treat that as "today"
   for the whole run. Never rely on a guessed date for what's recent/overdue.
1. Read the current rows from the data source so you know what exists. Bound your
   sweep to activity since the most recent 'Updated' (look back ~12h, or 3 days
   on the first run), measured against today's anchored date.
2. Sweep the connectors for new, relevant activity since the last run (email,
   Slack, Notion, Linear, calendar, meeting notes). Parse each signal to infer
   which row it belongs to and what is being asked. If a source is unreachable,
   note it in the summary rather than failing the run.
3. UPDATE existing rows ONLY when there is genuinely new signal. Refresh Stage,
   'What they need', and/or 'Next action' to reflect reality. Don't blank fields
   you have no new info on. Make any 'Next action' date a real date relative to
   today; replace stale past dates with the real next step.
4. CREATE rows for anything new. Set 'Needs triage' = true, put your best-guess
   inferred ask in 'What they need', Stage='Triage', a default Priority/Lead, and
   the source permalink in Source. Never invent entries with no evidence.
5. SUMMARY — KEEP IT SHORT. Send yourself a brief private message (a self-DM only
   you can see). Scannable in seconds:
   - Line 1: today's date + a one-line headline.
   - "Needs triage:" one line per item needing action (Title — the ask), or
     "Needs triage: none".
   - "Changed:" at most 3 lines, only for material changes made THIS run.
   If nothing needs triage and nothing material changed, send one line only.

Be conservative: better to flag something for triage than to silently overwrite
a correct row.
