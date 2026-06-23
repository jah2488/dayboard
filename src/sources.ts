import type { SectionSource } from "../shared/types";

// Each source pairs a color with an icon AND a label — never color alone
// (accessibility). Emoji icons keep zero icon-font dependency for Phase 1.
export const SOURCE_META: Record<
  SectionSource,
  { label: string; icon: string; color: string }
> = {
  slack: { label: "Slack", icon: "💬", color: "var(--color-slack)" },
  github: { label: "GitHub", icon: "🐙", color: "var(--color-github)" },
  notion: { label: "Notion", icon: "📓", color: "var(--color-notion)" },
  linear: { label: "Linear", icon: "📐", color: "var(--color-linear)" },
  datadog: { label: "Datadog", icon: "🐶", color: "var(--color-datadog)" },
  email: { label: "Email", icon: "✉️", color: "var(--color-email)" },
  calendar: { label: "Calendar", icon: "📅", color: "var(--color-calendar)" },
  "claude-sessions": {
    label: "Sessions",
    icon: "🧵",
    color: "var(--color-claude-sessions)",
  },
  learnings: { label: "Learnings", icon: "📚", color: "var(--color-learnings)" },
  "partner-tracker": {
    label: "Partners",
    icon: "🤝",
    color: "var(--color-slack)",
  },
  "morning-brief": {
    label: "Brief",
    icon: "☀️",
    color: "var(--color-calendar)",
  },
};
