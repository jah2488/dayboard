import { useEffect, useState } from "react";
import type { Usage, UsageRange } from "../../shared/types";
import { api } from "../api";

const RANGES: Array<{ key: UsageRange; label: string }> = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All time" },
];

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

// Sparse labels keep a dense axis readable: a weekday letter at each local
// midnight for 6h buckets, a weekday letter per day for daily, M/D per week.
function bucketLabel(startISO: string, bucketHours: number): string {
  const d = new Date(startISO);
  if (bucketHours <= 6) return d.getHours() === 0 ? WEEKDAY[d.getDay()] : "";
  if (bucketHours === 24) return WEEKDAY[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const granularityNote = (h: number) =>
  h <= 6 ? "6-hour buckets" : h === 24 ? "daily buckets" : "weekly buckets";

// Where the tokens actually go: you vs agent/subagents vs dashboard sweeps.
function UsageBreakdown({ totals }: { totals: Usage["totals"] }) {
  const denom = totals.totalTokens || 1;
  const wp = (n: number) => `${(n / denom) * 100}%`;
  const share = (n: number) => Math.round((n / denom) * 100);
  return (
    <section className="card trend-card usage-breakdown">
      <h2>Where the tokens go</h2>
      <div className="ub-bar">
        <span className="ub-seg interactive" style={{ width: wp(totals.interactiveTokens) }} />
        <span className="ub-seg agent" style={{ width: wp(totals.agentTokens) }} />
        <span className="ub-seg sweep" style={{ width: wp(totals.sweepTokens) }} />
      </div>
      <p className="muted legend ub-key">
        <span>
          <span className="swatch interactive" /> you {fmtTokens(totals.interactiveTokens)} (
          {share(totals.interactiveTokens)}%)
        </span>
        <span>
          <span className="swatch agent" /> agent {fmtTokens(totals.agentTokens)} (
          {share(totals.agentTokens)}%) · {totals.agentRuns.toLocaleString()} runs
        </span>
        <span>
          <span className="swatch sweep" /> sweeps {fmtTokens(totals.sweepTokens)} (
          {share(totals.sweepTokens)}%)
        </span>
      </p>
    </section>
  );
}

export function UsageCharts() {
  const [range, setRange] = useState<UsageRange>("week");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api
      .getUsage(range)
      .then((u) => live && setUsage(u))
      .catch(() => live && setUsage(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [range]);

  const maxBucket = Math.max(
    1,
    ...(usage?.buckets.map((b) => b.interactiveTokens + b.agentTokens + b.sweepTokens) ?? [0]),
  );
  const maxSessions = Math.max(1, ...(usage?.sessionsPerDay.map((d) => d.sessions) ?? [0]));
  const maxTopic = Math.max(1, ...(usage?.topTopics.map((t) => t.docs) ?? [0]));
  const pct = (v: number, max: number) => `${(v / max) * 100}%`;

  return (
    <section className="usage">
      <div className="usage-head">
        <h2>Token usage</h2>
        <div className="usage-range" role="tablist" aria-label="Usage time range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={range === r.key ? "active" : ""}
              aria-selected={range === r.key}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!usage ? (
        <p className="muted">{loading ? "…" : "No usage data."}</p>
      ) : (
        <>
          <div className="trend-totals">
            <div className="stat">
              <span className="n">{fmtTokens(usage.totals.totalTokens)}</span>
              <span className="l">tokens (in + out)</span>
            </div>
            <div className="stat">
              <span className="n">{Math.round(usage.totals.sweepShare * 100)}%</span>
              <span className="l">from sweeps</span>
            </div>
            <div className="stat">
              <span className="n">{usage.totals.sessions}</span>
              <span className="l">sessions</span>
            </div>
          </div>

          <UsageBreakdown totals={usage.totals} />

          <section className="card trend-card">
            <h2>Tokens over time</h2>
            <p className="muted" style={{ margin: "-0.4rem 0 0.8rem" }}>
              {granularityNote(usage.bucketHours)} · sweeps vs you
            </p>
            <div className="ubars">
              {usage.buckets.map((b) => {
                const total = b.interactiveTokens + b.agentTokens + b.sweepTokens;
                return (
                  <div
                    className="ubar-col"
                    key={b.start}
                    title={`${new Date(b.start).toLocaleString()}\ntotal ${fmtTokens(
                      total,
                    )} · you ${fmtTokens(b.interactiveTokens)} · agent ${fmtTokens(
                      b.agentTokens,
                    )} · sweeps ${fmtTokens(b.sweepTokens)}`}
                  >
                    <div className="ubar-track">
                      <div className="useg sweep" style={{ height: pct(b.sweepTokens, maxBucket) }} />
                      <div className="useg agent" style={{ height: pct(b.agentTokens, maxBucket) }} />
                      <div
                        className="useg interactive"
                        style={{ height: pct(b.interactiveTokens, maxBucket) }}
                      />
                    </div>
                    <span className="bar-d">{bucketLabel(b.start, usage.bucketHours)}</span>
                  </div>
                );
              })}
            </div>
            <p className="muted legend">
              <span className="swatch interactive" /> you&nbsp;&nbsp;
              <span className="swatch agent" /> agent/subagents&nbsp;&nbsp;
              <span className="swatch sweep" /> sweeps
            </p>
          </section>

          <section className="card trend-card">
            <h2>Claude sessions per day</h2>
            <div className="ubars">
              {usage.sessionsPerDay.map((d) => (
                <div className="ubar-col" key={d.date} title={`${d.date}: ${d.sessions} sessions`}>
                  <div className="ubar-track">
                    <div className="useg sessions" style={{ height: pct(d.sessions, maxSessions) }} />
                  </div>
                  <span className="bar-d">{WEEKDAY[new Date(d.date + "T00:00:00").getDay()]}</span>
                  {d.sessions > 0 && <span className="bar-cap">{d.sessions}</span>}
                </div>
              ))}
            </div>
          </section>

          <section className="card trend-card">
            <h2>Top topics</h2>
            {usage.topTopics.length === 0 ? (
              <p className="muted">No topics yet — run a brain sweep to build them.</p>
            ) : (
              <div className="topic-bars">
                {usage.topTopics.map((t) => (
                  <div className="topic-row" key={t.slug}>
                    <span className="topic-label" title={t.slug}>
                      {t.label}
                    </span>
                    <div className="topic-track">
                      <div className="topic-fill" style={{ width: pct(t.docs, maxTopic) }} />
                    </div>
                    <span className="topic-n">{t.docs}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
