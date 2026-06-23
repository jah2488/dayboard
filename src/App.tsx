import { useCallback, useEffect, useState } from "react";
import type { DayboardConfig, DayView, Insights, TabId } from "../shared/types";
import { api } from "./api";
import { todayLocal } from "./lib/time";
import { Greeting } from "./components/Greeting";
import { CurrentTask } from "./components/CurrentTask";
import { SectionCard } from "./components/SectionCard";
import { TasksPanel } from "./components/TasksPanel";
import { ClearedTray } from "./components/ClearedTray";
import { Sidebar } from "./components/Sidebar";
import { EditionBar } from "./components/EditionBar";
import { LearningsView } from "./components/LearningsView";
import { SessionsView } from "./components/SessionsView";
import { BrainView } from "./components/BrainView";
import { TrendsView } from "./components/TrendsView";
import { PrsView } from "./components/PrsView";
import { SettingsView } from "./components/SettingsView";
import { FirstRun } from "./components/FirstRun";
import { HeadsUp } from "./components/HeadsUp";
import { AlertPanel } from "./components/AlertPanel";
import { SweepProgress } from "./components/SweepProgress";

type Tab = TabId | "settings";

export function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [config, setConfig] = useState<DayboardConfig | null>(null);
  // First run = no data/config.json yet. null while we ask; true shows onboarding.
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  // When a session links to a learning doc, jump to Learnings with it preselected.
  const [learningFocus, setLearningFocus] = useState<string | null>(null);
  // Same jump for Brain → Sessions.
  const [sessionFocus, setSessionFocus] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocal());
  const [editionId, setEditionId] = useState<number | null>(null);
  const [view, setView] = useState<DayView | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeSweep = view?.activeSweep ?? null;

  // Config drives which tabs show + the greeting. Load once; SettingsView hands
  // back an updated copy after each save so the nav reflects toggles live.
  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {});
    api
      .getConfigStatus()
      .then((s) => setFirstRun(!s.configured))
      .catch(() => setFirstRun(false));
  }, []);
  const enabledTabs: TabId[] = config
    ? (Object.keys(config.tabs) as TabId[]).filter((t) => config.tabs[t])
    : (["today", "trends", "prs", "learnings", "sessions", "brain"] as TabId[]);

  // If the active tab gets toggled off, fall back to the first enabled one.
  useEffect(() => {
    if (tab !== "settings" && config && !config.tabs[tab]) {
      setTab(enabledTabs[0] ?? "settings");
    }
  }, [config, tab, enabledTabs]);

  // Load a day at a specific edition; sync selected edition + refresh insights.
  const load = useCallback((d: string, ed?: number | null) => {
    api.getInsights(d).then(setInsights).catch(() => {});
    return api
      .getDay(d, ed)
      .then((v) => {
        setView(v);
        setEditionId(v.selectedEditionId);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Changing date resets to that day's newest edition.
  useEffect(() => {
    setView(null);
    load(date, null);
  }, [date, load]);

  // While a sweep runs for the viewed day, follow the live (newest) edition and
  // re-poll until it settles. Driven by the server's activeSweep flag, so it
  // engages no matter how the sweep was triggered (UI button, MCP, or cron).
  // Self-reschedules: each load() returns a fresh activeSweep object, so this
  // effect re-runs and queues the next poll until activeSweep comes back null.
  // (Don't memoize the view or this loop stops firing.)
  useEffect(() => {
    if (!activeSweep) return;
    const id = setTimeout(() => load(date, null), 2500);
    return () => clearTimeout(id);
  }, [activeSweep, date, load]);

  // Run a mutation, then refetch the current edition.
  const run = (p: Promise<unknown>) =>
    p.then(() => load(date, editionId)).catch((e) => setError(String(e)));

  const doSweep = async () => {
    setError(null);
    const today = todayLocal();
    try {
      await api.startSweep(today);
      setDate(today);
      await load(today, null); // picks up activeSweep; the poll effect takes over
    } catch (e) {
      setError(String(e));
    }
  };

  const active = view?.sections.filter((s) => s.status === "active") ?? [];
  const cleared = view?.sections.filter((s) => s.status !== "active") ?? [];

  // First launch with no config: focus the onboarding screen (no sidebar).
  // "Open Settings" routes into the existing setup; "Skip" dismisses for now.
  if (firstRun) {
    return (
      <FirstRun
        onOpenSettings={() => {
          setFirstRun(false);
          setTab("settings");
        }}
        onSkip={() => setFirstRun(false)}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        tab={tab}
        onTab={setTab}
        date={date}
        onDate={setDate}
        sections={view?.sections ?? []}
        tabs={enabledTabs}
      />

      <div className="content">
        {tab === "settings" ? (
          <SettingsView config={config} onChange={setConfig} />
        ) : tab === "brain" ? (
          <BrainView
            onOpenLearning={(file) => {
              setLearningFocus(file);
              setTab("learnings");
            }}
            onOpenSession={(id) => {
              setSessionFocus(id);
              setTab("sessions");
            }}
          />
        ) : tab === "sessions" ? (
          <SessionsView
            focusSession={sessionFocus}
            onOpenLearning={(file) => {
              setLearningFocus(file);
              setTab("learnings");
            }}
          />
        ) : tab === "prs" ? (
          <PrsView />
        ) : tab === "learnings" ? (
          <LearningsView focusFile={learningFocus} />
        ) : tab === "trends" ? (
          <TrendsView
            insights={insights}
            onComplete={(id) => run(api.complete(id))}
            onCurrent={(id) => run(api.setCurrent(id))}
          />
        ) : error ? (
          <p style={{ color: "var(--color-email)" }}>✗ {error}</p>
        ) : !view ? (
          <p className="muted">…</p>
        ) : (
          <>
            <Greeting date={date} day={view.day} name={config?.identity.name ?? ""} />

            <AlertPanel
              issues={
                view.editions.find((e) => e.id === editionId)?.issues ?? []
              }
            />

            <HeadsUp insights={insights} onOpen={() => setTab("trends")} />

            <EditionBar
              editions={view.editions}
              selectedId={editionId}
              onSelect={(id) => load(date, id)}
              onSweep={doSweep}
              sweeping={!!activeSweep}
              canSweep
            />

            {activeSweep && <SweepProgress job={activeSweep} />}

            <div className="layout" style={{ marginTop: "1rem" }}>
              <div className="col-stack">
                <CurrentTask
                  task={view.tasks.current}
                  onComplete={(id) => run(api.complete(id))}
                  onUnpin={(id) => run(api.unpin(id))}
                />

                {active.length === 0 && !activeSweep && (
                  <p className="muted">
                    {view.editions.length === 0
                      ? "No sweeps yet — hit ↻ New sweep above to pull today together."
                      : "All sections cleared. 🎉"}
                  </p>
                )}
                {active.map((s) => (
                  <SectionCard
                    key={s.id}
                    section={s}
                    onDismiss={(id) => run(api.dismissSection(id))}
                    onAddTask={(title, sectionId, isCurrent) =>
                      run(
                        api.createTask({
                          title,
                          isCurrent,
                          sourceSectionId: sectionId,
                          sourceDate: date,
                        }),
                      )
                    }
                  />
                ))}

                <ClearedTray
                  sections={cleared}
                  onReopen={(id) => run(api.reopenSection(id))}
                />
              </div>

              <TasksPanel
                backlog={view.tasks.backlog}
                doneToday={view.tasks.doneToday}
                today={date}
                onAdd={(title) => run(api.createTask({ title, sourceDate: date }))}
                onComplete={(id) => run(api.complete(id))}
                onReopen={(id) => run(api.reopen(id))}
                onCurrent={(id) => run(api.setCurrent(id))}
                onRemove={(id) => run(api.remove(id))}
                onSetDue={(id, due) => run(api.setDue(id, due))}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
