import { useEffect, useState } from "react";
import type { ConfigCheck } from "../../shared/types";
import { api } from "../api";

const GLYPH: Record<ConfigCheck["checks"][number]["status"], string> = {
  ok: "✓",
  warn: "⚠",
  fail: "✗",
};

// Shown on first launch (no data/config.json yet): what dayboard is, what it
// needs, a live setup check, and a route into Settings to finish. Dismissable —
// once a config is saved it never shows again (the server reports configured).
export function FirstRun({
  onOpenSettings,
  onSkip,
}: {
  onOpenSettings: () => void;
  onSkip: () => void;
}) {
  const [check, setCheck] = useState<ConfigCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const runCheck = () => {
    setChecking(true);
    api
      .getConfigCheck()
      .then(setCheck)
      .finally(() => setChecking(false));
  };
  useEffect(runCheck, []);

  return (
    <div className="firstrun">
      <div className="firstrun-card card">
        <h1 className="firstrun-title">👋 Welcome to dayboard</h1>
        <p className="firstrun-lede">
          A local daily dashboard for Claude Code. Each morning it sweeps your world —
          Slack, Linear, email, calendar, GitHub and more — into scannable cards, turns
          any line into a task, and builds a knowledge graph over your notes and past
          Claude sessions.
        </p>

        <h2 className="firstrun-h2">What it needs</h2>
        <ul className="firstrun-needs">
          <li>
            <strong>Node 22.5+</strong> and the <strong>Claude CLI</strong> (<code>claude</code>)
            on your PATH — the sweep runs <code>claude -p</code>.
          </li>
          <li>
            <strong>Optional connectors</strong> (Slack, Linear, Notion, Datadog, Gmail,
            Calendar) and the <code>gh</code> CLI — it uses whatever's available.
          </li>
          <li>
            Your <strong>config</strong> lives in a gitignored <code>data/config.json</code>.
            Set it up below — nothing leaves your machine.
          </li>
        </ul>

        <div className="firstrun-check">
          <div className="set-card-head">
            <h2 className="firstrun-h2">Setup check</h2>
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
                    {GLYPH[c.status]}
                  </span>
                  <span className="set-check-body">
                    <span className="set-check-label">{c.label}</span>
                    <span className="muted set-check-detail">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="firstrun-actions">
          <button className="btn btn-primary" onClick={onOpenSettings}>
            Open Settings to finish setup →
          </button>
          <button className="btn btn-ghost" onClick={onSkip}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
