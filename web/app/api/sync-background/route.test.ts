import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  state: { running: false, updatedAt: null as string | null },
  stopped: false,
  afterCalls: 0,
  started: 0,
  stopRequested: 0,
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {
    h.afterCalls++;
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth", () => ({ authEnabled: () => false, verifySession: async () => true, SESSION_COOKIE: "s" }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/sync-control", () => ({ isSyncStopped: async () => h.stopped, SYNC_STOPPED_MESSAGE: "stopped" }));
vi.mock("@/lib/background-sync", () => ({
  loadBackgroundSync: async () => h.state,
  isStale: (s: { running: boolean; updatedAt: string | null }) => s.running && !s.updatedAt,
  startBackgroundSync: async () => {
    h.started++;
    return { running: true, updatedAt: "now" };
  },
  requestStop: async () => {
    h.stopRequested++;
    return { ...h.state, stopRequested: true };
  },
  runAndContinue: async () => {},
}));

import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://h/api/sync-background", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  h.state = { running: false, updatedAt: null };
  h.stopped = false;
  h.afterCalls = 0;
  h.started = 0;
  h.stopRequested = 0;
});

describe("/api/sync-background", () => {
  it("start answers at once and runs the first chunk after the response", async () => {
    const res = await post({ action: "start" });
    expect(res.status).toBe(202);
    expect(h.started).toBe(1);
    expect(h.afterCalls).toBe(1);
  });

  it("does not start a second run next to a live one", async () => {
    h.state = { running: true, updatedAt: "just now" };
    const res = await post({ action: "start" });
    expect(res.status).toBe(200);
    expect(h.started).toBe(0);
    expect(h.afterCalls).toBe(0);
  });

  it("refuses while Stop all syncing is on", async () => {
    h.stopped = true;
    expect((await post({})).status).toBe(423);
    expect(h.started).toBe(0);
  });

  it("stop asks the run to end", async () => {
    await post({ action: "stop" });
    expect(h.stopRequested).toBe(1);
  });

  it("a GET picks up a run whose chain went quiet", async () => {
    h.state = { running: true, updatedAt: null };
    await GET(new Request("http://h/api/sync-background"));
    expect(h.afterCalls).toBe(1);
  });

  it("a GET of a live run only reports", async () => {
    h.state = { running: true, updatedAt: "just now" };
    await GET(new Request("http://h/api/sync-background"));
    expect(h.afterCalls).toBe(0);
  });
});
