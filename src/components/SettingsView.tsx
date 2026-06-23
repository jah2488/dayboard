import { useEffect, useState } from "react";
import type {
  ConfigCheck,
  DayboardConfig,
  RoutineConfig,
  RoutinePrompt,
  TabId,
} from "../../shared/types";
import { api } from "../api";

const TAB_LABELS: Record<TabId, string> = {
  today: "Today",
  trends: "Trends",
  prs: "PRs",
  learnings: "Learnings",
  sessions: "Sessions",
  brain: "Brain",
};

const CHECK_GLYPH: Record<ConfigCheck["checks"][number]["status"], string> = {
  ok: "✓",
  warn: "⚠",
  fail: "✗",
};

// A labeled text input that saves on blur or Enter (only when the value
// actually changed) — keeps the config in sync without a save button per field.
function TextField({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onSave(draft);
  };
  return (
    <label className="set-field">
      <span className="set-field-label">{label}</span>
      <input
        className="set-input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="set-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="set-toggle-text">
        {label}
        {hint && <span className="muted set-toggle-hint"> — {hint}</span>}
      </span>
    </label>
  );
}

// One routine row: enable toggle (sweep routines only) + an inline prompt
// viewer/editor that writes a local override (or clears it back to the template).
function RoutineRow({
  prompt,
  toggle,
  onSaved,
}: {
  prompt: RoutinePrompt;
  toggle?: { checked: boolean; onChange: (v: boolean) => void };
  onSaved: (p: RoutinePrompt) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(prompt.raw);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(prompt.raw), [prompt.raw]);

  const save = async (content: string) => {
    setSaving(true);
    try {
      onSaved(await api.saveRoutinePrompt(prompt.name, content));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="set-routine">
      <div className="set-routine-head">
        {toggle ? (
          <Toggle label={prompt.label} checked={toggle.checked} onChange={toggle.onChange} />
        ) : (
          <span className="set-routine-name">{prompt.label}</span>
        )}
        <span className={`set-source set-source-${prompt.source}`}>{prompt.source}</span>
        <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide prompt" : "View / edit prompt"}
        </button>
      </div>
      {open && (
        <div className="set-prompt">
          <textarea
            className="set-textarea"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="set-prompt-actions">
            <button
              className="btn btn-primary"
              disabled={saving || draft === prompt.raw}
              onClick={() => save(draft)}
            >
              Save override
            </button>
            {prompt.source === "override" && (
              <button className="btn" disabled={saving} onClick={() => save("")}>
                Revert to template
              </button>
            )}
            <span className="muted set-prompt-note">
              Saved as a local override (gitignored). {"{{identity.name}}"} and other config
              values are substituted at sweep time.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsView({
  config,
  onChange,
}: {
  config: DayboardConfig | null;
  onChange: (c: DayboardConfig) => void;
}) {
  const [check, setCheck] = useState<ConfigCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [routines, setRoutines] = useState<{ sweep: RoutinePrompt[]; brain: RoutinePrompt[] } | null>(
    null,
  );
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);

  const runCheck = () => {
    setChecking(true);
    api
      .getConfigCheck()
      .then(setCheck)
      .finally(() => setChecking(false));
  };
  useEffect(() => {
    runCheck();
    api.getRoutines().then(setRoutines).catch(() => {});
  }, []);

  if (!config) return <p className="muted">…</p>;

  // Merge a patch, persist, and lift the fresh config back up to App.
  const save = (patch: Record<string, unknown>) => api.patchConfig(patch).then(onChange);

  const setTab = (id: TabId, on: boolean) => save({ tabs: { [id]: on } });
  const setRoutineEnabled = (name: string, on: boolean) => {
    const next: RoutineConfig[] = config.routines.map((r) =>
      r.name === name ? { ...r, enabled: on } : r,
    );
    save({ routines: next });
  };
  const replaceRoutinePrompt = (updated: RoutinePrompt) =>
    setRoutines((cur) =>
      cur
        ? {
            sweep: cur.sweep.map((r) => (r.name === updated.name ? updated : r)),
            brain: cur.brain.map((r) => (r.name === updated.name ? updated : r)),
          }
        : cur,
    );

  const saveSchedule = async (hour: number, minute: number) => {
    const r = await api.setSchedule(hour, minute);
    setScheduleMsg(r.detail);
    onChange({ ...config, schedule: { hour, minute } });
  };

  const time = `${String(config.schedule.hour).padStart(2, "0")}:${String(
    config.schedule.minute,
  ).padStart(2, "0")}`;

  return (
    <div className="settings">
      <h1 style={{ fontSize: "1.6rem", margin: "0 0 1rem" }}>Settings</h1>

      <section className="card set-card">
        <div className="set-card-head">
          <h2>Setup check</h2>
          <button className="btn" onClick={runCheck} disabled={checking}>
            {checking ? "Checking…" : "Re-run"}
          </button>
        </div>
        {!check ? (
          <p className="muted">…</p>
        ) : (
          <ul className="set-checks">
            {check.checks.map((c) => (
              <li key={c.id} className={`set-check set-check-${c.status}`}>
                <span className="set-check-glyph" aria-hidden="true">
                  {CHECK_GLYPH[c.status]}
                </span>
                <span className="set-check-body">
                  <span className="set-check-label">{c.label}</span>
                  <span className="muted set-check-detail">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card set-card">
        <h2>Identity &amp; paths</h2>
        <TextField
          label="Your name (greeting + routine context)"
          value={config.identity.name}
          placeholder="e.g. Ada"
          onSave={(v) => save({ identity: { name: v } })}
        />
        <TextField
          label="Learnings directory"
          value={config.paths.learningsDir}
          placeholder="~/Projects/learnings"
          onSave={(v) => save({ paths: { learningsDir: v } })}
        />
        <TextField
          label="Claude transcripts directory"
          value={config.paths.claudeProjectsDir}
          placeholder="~/.claude/projects"
          onSave={(v) => save({ paths: { claudeProjectsDir: v } })}
        />
        <TextField
          label="GitHub org for the PRs tab (blank to disable)"
          value={config.github.org}
          placeholder="my-org"
          onSave={(v) => save({ github: { org: v } })}
        />
      </section>

      <section className="card set-card">
        <h2>Tabs</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Show or hide the navigation tabs.
        </p>
        <div className="set-toggle-grid">
          {(Object.keys(config.tabs) as TabId[]).map((id) => (
            <Toggle
              key={id}
              label={TAB_LABELS[id]}
              checked={config.tabs[id]}
              onChange={(on) => setTab(id, on)}
            />
          ))}
        </div>
      </section>

      <section className="card set-card">
        <h2>Sweep schedule</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          When the morning sweep runs (macOS launchd). Saving reschedules it live.
        </p>
        <div className="set-schedule">
          <input
            type="time"
            className="set-input set-time"
            defaultValue={time}
            onBlur={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (Number.isInteger(h) && Number.isInteger(m)) saveSchedule(h, m);
            }}
          />
          {scheduleMsg && <span className="muted set-schedule-msg">{scheduleMsg}</span>}
        </div>
      </section>

      <section className="card set-card">
        <h2>Sweep sections &amp; prompts</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Toggle which routines run, and view or customize the prompt each one sends.
        </p>
        {!routines ? (
          <p className="muted">…</p>
        ) : (
          <>
            {routines.sweep.map((p) => (
              <RoutineRow
                key={p.name}
                prompt={p}
                toggle={{
                  checked: config.routines.find((r) => r.name === p.name)?.enabled ?? false,
                  onChange: (on) => setRoutineEnabled(p.name, on),
                }}
                onSaved={replaceRoutinePrompt}
              />
            ))}
            <h3 className="set-subhead">Brain prompts</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Used by the knowledge-graph sweep. Always on; editable.
            </p>
            {routines.brain.map((p) => (
              <RoutineRow key={p.name} prompt={p} onSaved={replaceRoutinePrompt} />
            ))}
          </>
        )}
      </section>
    </div>
  );
}
