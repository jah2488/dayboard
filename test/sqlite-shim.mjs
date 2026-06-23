// Vitest's bundled Vite can't resolve the (experimental, not-in-builtinModules)
// `node:sqlite` import. Load it via native require and re-export the names db.ts
// uses. Test-only — the app imports node:sqlite directly.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite");

export const DatabaseSync = sqlite.DatabaseSync;
