import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const sqliteShim = fileURLToPath(new URL("./test/sqlite-shim.mjs", import.meta.url));

// Unit + integration tests. Per-file environment via the `// @vitest-environment`
// docblock (node by default; jsdom for component tests). Playwright e2e lives in
// e2e/ and runs separately via `npm run test:e2e`.
export default defineConfig({
  plugins: [react()],
  // node:sqlite is newer than the Vite bundled with Vitest, which can't resolve
  // it. Route it through a shim that loads it via native require (test-only).
  resolve: { alias: { "node:sqlite": sqliteShim } },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["{src,server,shared}/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}", "server/**/*.ts", "shared/**/*.ts"],
      exclude: [
        "src/main.tsx",
        "shared/types.ts", // type-only declarations, no runtime code
        "server/index.ts", // boot/serve glue — exercised by e2e, not unit
        "server/mcp.ts",
        "server/seed.ts",
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
      ],
    },
  },
});
