// Single source of truth for the section scroll-anchor id. Section cards
// (active) and Cleared-tray rows (dismissed) both render this id so the sidebar
// jump nav can find either. Change the scheme here, not in three components.
export function sectionAnchorId(id: number): string {
  return `section-${id}`;
}

// Scroll a section into view, opening the Cleared tray first if the target is a
// dismissed section tucked inside it.
export function scrollToSection(id: number): void {
  const el = document.getElementById(sectionAnchorId(id));
  if (!el) return;
  const details = el.closest("details");
  if (details && !details.open) details.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
