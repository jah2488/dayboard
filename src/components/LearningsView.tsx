import { useEffect, useMemo, useState } from "react";
import type { LearningContent, LearningDoc } from "../../shared/types";
import { api } from "../api";
import { Markdown } from "./Markdown";

function prettyDocDate(date: string | null): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function LearningsView({ focusFile }: { focusFile?: string | null }) {
  const [docs, setDocs] = useState<LearningDoc[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [doc, setDoc] = useState<LearningContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listLearnings().then(setDocs).catch((e) => setError(String(e)));
  }, []);

  // A doc opened from a session link wins over the default selection.
  useEffect(() => {
    if (focusFile) setSelected(focusFile);
  }, [focusFile]);

  // Auto-select the newest doc once loaded.
  useEffect(() => {
    if (docs && docs.length && !selected) setSelected(docs[0].file);
  }, [docs, selected]);

  useEffect(() => {
    if (!selected) return;
    setDoc(null);
    api.getLearning(selected).then(setDoc).catch((e) => setError(String(e)));
  }, [selected]);

  const filtered = useMemo(() => {
    if (!docs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(
      (d) =>
        d.title.toLowerCase().includes(q) || d.file.toLowerCase().includes(q),
    );
  }, [docs, query]);

  if (error) return <p style={{ color: "var(--color-email)" }}>✗ {error}</p>;

  return (
    <div className="learnings">
      <aside className="learn-list card">
        <input
          className="learn-search"
          placeholder="Search learnings…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {docs === null && <p className="muted" style={{ padding: "0.5rem" }}>…</p>}
        {docs !== null && filtered.length === 0 && (
          <p className="muted" style={{ padding: "0.5rem" }}>
            No matching docs.
          </p>
        )}
        {filtered.map((d) => (
          <button
            key={d.file}
            className={`learn-item${selected === d.file ? " active" : ""}`}
            onClick={() => setSelected(d.file)}
          >
            <span className="learn-title">{d.title}</span>
            <span className="learn-date">{prettyDocDate(d.date)}</span>
          </button>
        ))}
      </aside>

      <article className="learn-pane card">
        {!doc && <p className="muted">Select a doc to read.</p>}
        {doc && <Markdown>{doc.content}</Markdown>}
      </article>
    </div>
  );
}
