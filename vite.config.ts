import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev: Vite serves the UI on 5173 and proxies /api + /mcp to the Hono server on 4747.
// Prod: `vite build` -> dist/, which the Hono server serves directly.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist" },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4747",
      "/mcp": "http://localhost:4747",
    },
  },
});
