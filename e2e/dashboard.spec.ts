import { expect, test } from "@playwright/test";

// One end-to-end journey through the real built app: an empty board, a sweep
// that fills it (including the new Email + Calendar sections), the sidebar jump
// nav, and dismissing a card.
//
// NOTE: SWEEP_MOCK returns the same canned brief for *every* routine, and there
// are two (morning-brief + partners), so each section appears twice here. In
// production the routines return different content. We scope to .first().
test("sweep → board fills with email + calendar → sidebar jump → dismiss", async ({
  page,
}) => {
  await page.goto("/");

  // Fresh day: nothing swept yet.
  await expect(page.getByText("All sections cleared.")).toBeVisible();

  // Run a sweep (mocked brief).
  await page.getByRole("button", { name: "↻ New sweep" }).click();

  // The new Email + Calendar sections render end-to-end in a real browser.
  await expect(page.getByText("Email — needs a reply").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Calendar — today's schedule").first()).toBeVisible();
  await expect(page.getByText("Slack — needs a reply").first()).toBeVisible();
  await expect(page.getByText("All sections cleared.")).toHaveCount(0);

  // Sidebar jump nav: a clickable icon per section that scrolls to the card.
  const emailJump = page.getByRole("button", { name: /Jump to Email/ }).first();
  await expect(emailJump).toBeVisible();
  await emailJump.click();
  const emailCard = page.locator("section.card", { hasText: "Email — needs a reply" }).first();
  await expect(emailCard).toBeInViewport();

  // Dismissing a card moves it to the Cleared tray.
  const slackCard = page.locator("section.card", { hasText: "Slack — needs a reply" }).first();
  await slackCard.getByRole("button", { name: /section done/i }).click();
  await expect(page.getByText(/Cleared \(\d+\)/)).toBeVisible();
});
