// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function mockFetch(body: unknown, ok = true) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Server Error",
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("getDay hits the day endpoint, with and without an edition", async () => {
    const f = mockFetch({ date: "2026-06-08" });
    await api.getDay("2026-06-08");
    expect(f).toHaveBeenLastCalledWith("/api/days/2026-06-08");
    await api.getDay("2026-06-08", 3);
    expect(f).toHaveBeenLastCalledWith("/api/days/2026-06-08?edition=3");
  });

  it("startSweep POSTs the date as JSON", async () => {
    const f = mockFetch({ id: "j1" });
    await api.startSweep("2026-06-08");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/sweep");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init.body)).toEqual({ date: "2026-06-08", label: undefined });
  });

  it.each([
    ["dismissSection", () => api.dismissSection(5), "/api/sections/5/dismiss", "POST"],
    ["reopenSection", () => api.reopenSection(5), "/api/sections/5/reopen", "POST"],
    ["setCurrent", () => api.setCurrent(5), "/api/tasks/5/current", "POST"],
    ["unpin", () => api.unpin(5), "/api/tasks/5/unpin", "POST"],
    ["complete", () => api.complete(5), "/api/tasks/5/complete", "POST"],
    ["reopen", () => api.reopen(5), "/api/tasks/5/reopen", "POST"],
    ["remove", () => api.remove(5), "/api/tasks/5", "DELETE"],
    ["getInsights", () => api.getInsights("2026-06-08"), "/api/insights?date=2026-06-08", undefined],
    ["listLearnings", () => api.listLearnings(), "/api/learnings", undefined],
    ["getLearning", () => api.getLearning("a b.md"), "/api/learnings/a%20b.md", undefined],
  ])("%s calls the right route", async (_name, call, url, method) => {
    const f = mockFetch({});
    await call();
    const [calledUrl, init] = f.mock.calls[0];
    expect(calledUrl).toBe(url);
    if (method) expect(init.method).toBe(method);
  });

  it("createTask and setDue send JSON bodies", async () => {
    const f = mockFetch({});
    await api.createTask({ title: "x" });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ title: "x" });
    await api.setDue(5, "2026-06-10");
    expect(f.mock.calls[1][0]).toBe("/api/tasks/5");
    expect(f.mock.calls[1][1].method).toBe("PATCH");
  });

  it("throws on a non-ok response", async () => {
    mockFetch({}, false);
    await expect(api.getDay("2026-06-08")).rejects.toThrow("500 Server Error");
  });
});
