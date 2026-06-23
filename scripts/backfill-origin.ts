// One-time backfill: origin is deterministic transcript metadata, but session
// connections indexed before the field existed all normalize to the "agent"
// default on read. Re-derive each session's real origin from its transcript
// entrypoint (no LLM, no re-index) and rewrite the record when it differs.
// Safe to re-run; a no-op once everything is correct.
import { readFileSync } from "node:fs";
import { transcriptFiles } from "../server/sessions.ts";
import { sessionOrigin } from "../server/sessions-parse.ts";
import { readAllConnections, writeConnections } from "../server/brain-store.ts";

const transcripts = new Map(transcriptFiles().map((t) => [`session:${t.id}`, t.path]));

let fixed = 0;
for (const conn of readAllConnections()) {
  if (conn.kind !== "session") continue;
  const path = transcripts.get(conn.id);
  if (!path) continue; // source gone — leave it; the sweep will retire it
  const events = readFileSync(path, "utf8")
    .split("\n")
    .flatMap((l) => (l.trim() ? [JSON.parse(l)] : []));
  const origin = sessionOrigin(events);
  if (origin !== conn.origin) {
    writeConnections({ ...conn, origin });
    fixed++;
  }
}
console.log(`backfilled origin on ${fixed} session connection records`);
