import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// DAYBOARD_DATA_DIR lets tests (and alternate deployments) point the SQLite file
// at an isolated location instead of clobbering the real ./data/dayboard.db.
const dataDir = process.env.DAYBOARD_DATA_DIR ?? join(root, "data");
const migrationsDir = join(root, "db", "migrations");

mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, "dayboard.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// Minimal forward-only migration runner: applies any .sql file in
// db/migrations not yet recorded, in filename order.
function runMigrations(): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));",
  );
  const applied = new Set(
    db
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((r) => (r as { name: string }).name),
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    console.log(`[db] applied migration ${file}`);
  }
}

runMigrations();

// node:sqlite has no .transaction() helper (unlike better-sqlite3); wrap manually.
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function tableNames(): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name",
    )
    .all()
    .map((r) => (r as { name: string }).name);
}
