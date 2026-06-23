import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db, tableNames } from "./db.ts";
import { api } from "./api.ts";
import { localDate } from "./util.ts";
import { writeSnapshot } from "./snapshot.ts";
import type { HealthResponse } from "../shared/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const PORT = Number(process.env.PORT ?? 4747);

const app = new Hono();

app.get("/api/health", (c) => {
  const body: HealthResponse = {
    ok: true,
    date: localDate(),
    tables: tableNames(),
  };
  return c.json(body);
});

app.route("/api", api);

// Serve the built UI in production (dist/ exists after `npm run build`).
if (existsSync(distDir)) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("/*", serveStatic({ path: "./dist/index.html" }));
}

// Touch db so the import isn't tree-shaken in case health changes later.
void db;

writeSnapshot(); // seed state/today.json on startup

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[dayboard] http://localhost:${info.port}`);
});
