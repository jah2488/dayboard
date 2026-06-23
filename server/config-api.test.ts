import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Point config at a throwaway file BEFORE api.ts (-> config.ts) loads, so these
// tests read/write a scratch config rather than the repo's data/config.json.
const scratch = mkdtempSync(join(tmpdir(), "dayboard-cfgapi-"));
process.env.DAYBOARD_CONFIG = join(scratch, "config.json");
process.env.DAYBOARD_ROUTINES_DIR = join(scratch, "routines");

let api: typeof import("./api.ts").api;

const reqBody = async (path: string, method = "GET", body?: unknown): Promise<any> => {
  const res = await api.request(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  api = (await import("./api.ts")).api;
});

describe("config API", () => {
  it("GET /config returns the resolved config", async () => {
    const { status, body } = await reqBody("/config");
    expect(status).toBe(200);
    expect(body.tabs.today).toBe(true);
    expect(Array.isArray(body.routines)).toBe(true);
  });

  it("PATCH /config merges and persists a partial patch", async () => {
    const { body } = await reqBody("/config", "PATCH", { identity: { name: "Ada" }, tabs: { prs: false } });
    expect(body.identity.name).toBe("Ada");
    expect(body.tabs.prs).toBe(false);
    expect(body.tabs.today).toBe(true); // untouched
    // persisted: a fresh GET sees it
    expect((await reqBody("/config")).body.identity.name).toBe("Ada");
  });

  it("PATCH /config rejects a non-object body", async () => {
    expect((await reqBody("/config", "PATCH", [1, 2])).status).toBe(400);
  });

  it("GET /config/check returns a diagnostics list", async () => {
    const { body } = await reqBody("/config/check");
    expect(typeof body.ok).toBe("boolean");
    expect(body.checks.some((c: { id: string }) => c.id === "claude-bin")).toBe(true);
  });

  it("GET /routines groups sweep + brain prompts", async () => {
    const { body } = await reqBody("/routines");
    expect(Array.isArray(body.sweep)).toBe(true);
    expect(body.brain.map((r: { name: string }) => r.name)).toContain("brain-sweep");
  });

  it("PUT then re-PUT(blank) a routine override round-trips", async () => {
    const saved = await reqBody("/routines/morning-brief/prompt", "PUT", { content: "MY PROMPT" });
    expect(saved.body.source).toBe("override");
    expect(saved.body.raw).toBe("MY PROMPT");
    const cleared = await reqBody("/routines/morning-brief/prompt", "PUT", { content: "" });
    expect(cleared.body.source).not.toBe("override"); // fell back to template (or none)
  });

  it("POST /schedule validates the time range", async () => {
    expect((await reqBody("/schedule", "POST", { hour: 25, minute: 0 })).status).toBe(400);
    expect((await reqBody("/schedule", "POST", { hour: 8, minute: 90 })).status).toBe(400);
    // a valid time persists to config even if the launchd agent isn't installed
    const ok = await reqBody("/schedule", "POST", { hour: 8, minute: 30 });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.applied).toBe("boolean");
    expect((await reqBody("/config")).body.schedule).toEqual({ hour: 8, minute: 30 });
  });
});
