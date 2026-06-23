// One-time cleanup: the Brain used to index the dashboard's own routine
// transcripts (sweep/synthesis/verify/brief). Those connections now linger
// until a sweep's vanish-detection removes them. This does it without a model
// call — re-derive the machinery session ids and drop their connections (and
// every reference to them), exactly as the sweep would. Safe to re-run.
import { listBrainSessions, listSessions } from "../server/sessions.ts";
import { readAllConnections, deleteConnections, writeConnections } from "../server/brain-store.ts";
import { removeDoc } from "../server/brain-merge.ts";
import { readTopics } from "../server/brain-store.ts";

const eligible = new Set(listBrainSessions().map((s) => `session:${s.id}`));
const machinery = new Set(
  listSessions()
    .map((s) => `session:${s.id}`)
    .filter((id) => !eligible.has(id)),
);

let state = {
  connections: new Map(readAllConnections().map((c) => [c.id, c] as const)),
  topics: readTopics(),
};

let removed = 0;
for (const id of [...state.connections.keys()].filter((id) => machinery.has(id))) {
  const next = removeDoc(state, id);
  for (const [cid, conn] of next.connections) {
    if (state.connections.get(cid) !== conn) writeConnections(conn); // links scrubbed
  }
  deleteConnections(id);
  state = next;
  removed++;
}
console.log(`removed ${removed} dashboard-machinery connection records`);
