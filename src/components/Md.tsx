import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Links always open in a new tab (the dashboard is a jumping-off point).
const components = {
  a: (props: ComponentProps<"a">) => (
    <a {...props} target="_blank" rel="noreferrer" />
  ),
};

// Block markdown for full-prose docs (learnings). Styling lives in .md-body.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

// Inline markdown for one-liners (section items, task titles). Renders the
// paragraph as a span (not a block <p>) so it nests legally inside inline
// containers, and keeps links so anything turned into a task stays clickable.
const inlineComponents = {
  ...components,
  p: ({ children }: ComponentProps<"p">) => <span>{children}</span>,
};

export function MdInline({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineComponents}>
      {children}
    </ReactMarkdown>
  );
}
