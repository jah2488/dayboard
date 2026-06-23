import { useEffect, useState } from "react";
import type { Section, TabId } from "../../shared/types";
import { SOURCE_META } from "../sources";
import { scrollToSection } from "../lib/sectionAnchor";
import { DayNav } from "./DayNav";

type Tab = TabId | "settings";

const NAV: Array<{ id: TabId; icon: string; label: string }> = [
  { id: "today", icon: "☀️", label: "Today" },
  { id: "trends", icon: "📈", label: "Trends" },
  { id: "prs", icon: "📥", label: "PRs" },
  { id: "learnings", icon: "📚", label: "Learnings" },
  { id: "sessions", icon: "🧵", label: "Sessions" },
  { id: "brain", icon: "🧠", label: "Brain" },
];

const COLLAPSE_KEY = "dayboard:sidebar-collapsed";

// localStorage may be unavailable (private mode, test stubs) — degrade quietly.
function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore — preference just won't persist
  }
}

export function Sidebar({
  tab,
  onTab,
  date,
  onDate,
  sections,
  tabs,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  date: string;
  onDate: (d: string) => void;
  sections: Section[];
  tabs: TabId[]; // which content tabs are enabled in config
}) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  useEffect(() => {
    saveCollapsed(collapsed);
  }, [collapsed]);

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="brand-row">
        <span className="brand">dayboard</span>
        <button
          className="side-toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="side-nav" aria-label="Sections">
        {NAV.filter((n) => tabs.includes(n.id)).map(({ id, icon, label }) => (
          <button
            key={id}
            className={`side-link${tab === id ? " active" : ""}`}
            onClick={() => onTab(id)}
            title={collapsed ? label : undefined}
            aria-label={label}
          >
            <span className="side-ico" aria-hidden="true">
              {icon}
            </span>
            <span className="side-text">{label}</span>
          </button>
        ))}
        <button
          key="settings"
          className={`side-link side-link-settings${tab === "settings" ? " active" : ""}`}
          onClick={() => onTab("settings")}
          title={collapsed ? "Settings" : undefined}
          aria-label="Settings"
        >
          <span className="side-ico" aria-hidden="true">
            ⚙️
          </span>
          <span className="side-text">Settings</span>
        </button>
      </nav>

      {!collapsed && tab === "today" && sections.length > 0 && (
        <div className="side-section">
          <div className="side-label">Jump to</div>
          <div className="side-jump">
            {sections.map((s) => {
              const meta = SOURCE_META[s.source];
              const done = s.status !== "active";
              return (
                <button
                  key={s.id}
                  className={`jump-icon${done ? " done" : ""}`}
                  title={`${s.title}${done ? " (cleared)" : ""}`}
                  aria-label={`Jump to ${meta.label}: ${s.title}`}
                  onClick={() => scrollToSection(s.id)}
                >
                  {meta.icon}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!collapsed && tab === "today" && (
        <div className="side-section">
          <DayNav date={date} onChange={onDate} />
        </div>
      )}
    </aside>
  );
}
