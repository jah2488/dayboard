import type { Section } from "../../shared/types";
import { SOURCE_META } from "../sources";
import { sectionAnchorId } from "../lib/sectionAnchor";
import { MdInline } from "./Md";

type Block =
  | { kind: "item"; text: string }
  | { kind: "md"; text: string };

// Split markdown into interactive list-item rows + plain markdown blocks, so
// any line item can be turned into a task.
function parseBlocks(md: string): Block[] {
  const out: Block[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      out.push({ kind: "md", text: buf.join("\n") });
      buf = [];
    }
  };
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      flush();
      out.push({ kind: "item", text: m[1] });
    } else if (line.trim() === "") {
      flush();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

export function SectionCard({
  section,
  onDismiss,
  onAddTask,
}: {
  section: Section;
  onDismiss: (id: number) => void;
  onAddTask: (title: string, sectionId: number, isCurrent: boolean) => void;
}) {
  const meta = SOURCE_META[section.source];
  const blocks = parseBlocks(section.bodyMd);

  return (
    <section
      id={sectionAnchorId(section.id)}
      className="card"
      style={{ ["--source" as string]: meta.color }}
    >
      <div className="card-head">
        <span className="icon" aria-hidden>
          {meta.icon}
        </span>
        <span className="title">{section.title}</span>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          {meta.label}
        </span>
        <button
          className="btn btn-done"
          onClick={() => onDismiss(section.id)}
          aria-label={`Mark ${meta.label} section done`}
        >
          ✓ Done
        </button>
      </div>
      <div className="card-body">
        {blocks.map((b, i) =>
          b.kind === "item" ? (
            <div className="item" key={i}>
              <span className="text">
                <MdInline>{b.text}</MdInline>
              </span>
              <span className="item-actions">
                <button
                  className="btn"
                  onClick={() => onAddTask(b.text, section.id, true)}
                  title="Make this my current task"
                >
                  + Now
                </button>
                <button
                  className="btn"
                  onClick={() => onAddTask(b.text, section.id, false)}
                  title="Add to backlog"
                >
                  + Backlog
                </button>
              </span>
            </div>
          ) : (
            <div className="item" key={i}>
              <span className="text">
                <MdInline>{b.text}</MdInline>
              </span>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
