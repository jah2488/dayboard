import { defineConfig, devices } from "@playwright/test";

// E2E runs the real built app (Hono serving dist/) against a throwaway DB with a
// mocked sweep, on a port distinct from the dev server (4747).
const PORT = 4848;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && rm -rf /tmp/dayboard-e2e && SWEEP_MOCK=1 DAYBOARD_DATA_DIR=/tmp/dayboard-e2e DAYBOARD_STATE_DIR=/tmp/dayboard-e2e LEARNINGS_DIR=/tmp/dayboard-e2e/learnings PORT=${PORT} npm run start`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
