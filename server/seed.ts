// Seeds today (and a little of yesterday) with realistic sample data so the
// UI can be exercised before Phase 2 wires the real routines.
// Run: npm run seed
import { db } from "./db.ts";
import * as repo from "./repo.ts";

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstMeetingIso(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

// Reset sample data (keep schema). Delete in FK-dependency order:
// tasks -> sections -> editions -> days.
db.exec(
  "DELETE FROM tasks; DELETE FROM sections; DELETE FROM editions; DELETE FROM days;",
);

const today = localDate();
const yesterday = localDate(-1);

repo.upsertDay({
  date: today,
  greeting: "Good morning.",
  firstMeetingAt: firstMeetingIso(9),
  meetingCount: 4,
});
repo.upsertDay({ date: yesterday, greeting: "Good morning.", meetingCount: 3 });

const todayEd = repo.createEdition({ date: today, label: "Morning", trigger: "seed" });
repo.createEdition({ date: yesterday, label: "Morning", trigger: "seed" });

repo.createSection({
  editionId: todayEd.id,
  date: today,
  source: "slack",
  title: "Slack — 3 threads need you",
  sort: 1,
  bodyMd: [
    "- [**#team**](https://example.slack.com/archives/C01TEAM/p1717400000) Someone asked for the launch timeline — wants it before the 30th",
    "- [**#general**](https://example.slack.com/archives/C02GEN/p1717400100) You were tagged on the rollout thread",
    "- [**DM**](https://example.slack.com/archives/D03DM/p1717400200) quick question about the settings UI",
  ].join("\n"),
});

repo.createSection({
  editionId: todayEd.id,
  date: today,
  source: "github",
  title: "GitHub — 2 review requests",
  sort: 2,
  bodyMd: [
    "- [`web-app#4821`](https://github.com/acme/web-app/pull/4821) Add account provisioning (review requested)",
    "- [`api#1190`](https://github.com/acme/api/pull/1190) Database delegation seam follow-up",
  ].join("\n"),
});

repo.createSection({
  editionId: todayEd.id,
  date: today,
  source: "linear",
  title: "Linear — 1 issue assigned, 2 mentions",
  sort: 3,
  bodyMd: [
    "- [**ENG-214**](https://linear.app/acme/issue/ENG-214) Scope the integration launch (assigned)",
    "- mentioned in [**ENG-198**](https://linear.app/acme/issue/ENG-198), [**ENG-201**](https://linear.app/acme/issue/ENG-201)",
  ].join("\n"),
});

repo.createSection({
  editionId: todayEd.id,
  date: today,
  source: "calendar",
  title: "Calendar — 4 meetings",
  sort: 4,
  bodyMd: [
    "- **9:00** Project sync",
    "- **11:30** 1:1",
    "- **14:00** Integration scoping",
    "- **16:00** Team standup",
  ].join("\n"),
});

// Tasks: one pinned current, some backlog, one carried from yesterday, one done today.
repo.createTask({
  title:
    "Reply to the [thread](https://example.slack.com/archives/C01TEAM/p1717400000) with the launch timeline",
  isCurrent: true,
  sourceDate: today,
});
const review = repo.createTask({ title: "Review web-app#4821", sourceDate: today });
repo.createTask({ title: "Prep integration scoping notes", sourceDate: today });
const carried = repo.createTask({
  title: "Follow up on the rollout (carried)",
  sourceDate: yesterday,
});
const done = repo.createTask({ title: "Skim overnight Slack", sourceDate: today });
repo.completeTask(done.id);

// --- Phase 4 demo data: due dates, an aged (stale) task, weekly completions ---
const dayOffset = (n: number) => localDate(n);
// Due dates: overdue, due today, due soon.
repo.updateTask(carried.id, { dueDate: dayOffset(-1) }); // overdue
repo.updateTask(review.id, { dueDate: today }); // due today
const soon = repo.createTask({ title: "Send the recap", sourceDate: today });
repo.updateTask(soon.id, { dueDate: dayOffset(2) }); // due soon

// Backdate the carried task so it reads as "lingering" (open 5 days).
db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(
  `${dayOffset(-5)} 09:00:00`,
  carried.id,
);

// Seed a week of completions for the trend chart.
const weekly = [2, 1, 3, 0, 2, 4]; // 6 days ago .. yesterday
weekly.forEach((count, i) => {
  const d = dayOffset(-(6 - i));
  for (let k = 0; k < count; k++) {
    const t = repo.createTask({ title: `Done ${d} #${k + 1}`, sourceDate: d });
    db.prepare(
      "UPDATE tasks SET status='done', completed_at = ?, created_at = ? WHERE id = ?",
    ).run(`${d} 14:00:00`, `${d} 09:00:00`, t.id);
  }
});

console.log(`[seed] populated ${today} (and ${yesterday}). Open dashboard at http://localhost:4747`);
