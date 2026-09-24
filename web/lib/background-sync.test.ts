import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The server-side "Sync all" (lib/background-sync): chunks that stop on their
 * budget, the backlog running out, an error or Stop, and hand over otherwise.
 */

const h = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  results: [] as unknown[],
  lockFree: true,
  logged: [] as unknown[],
}));

vi.mock("./db", () => ({ getDb: () => ({}) }));
vi.mock("./sync-one", () => ({
  syncOneWorkout: vi.fn(async () => {
    const next = h.results.shift();
    if (next instanceof Error) throw next;
    return next ?? { status: "none", remaining: 0 };
  }),
}));
vi.mock("./sync-lock-store", () => ({ postgresLockBackend: () => ({}) }));
vi.mock("./sync-store", () => ({ postgresSyncStore: () => ({}) }));
vi.mock("@/engine", () => ({
  acquireSyncLock: async () => (h.lockFree ? { key: "sync", token: "t", release: async () => {} } : null),
  recordSyncRun: async (_s: unknown, r: unknown, trigger: string) => {
    h.logged.push({ ...(r as object), trigger });
    return true;
  },
}));

import {
  runChunk,
  startBackgroundSync,
  requestStop,
  loadBackgroundSync,
  isStale,
  BACKGROUND_SYNC_KEY,
} from "./background-sync";
import { SyncStoppedError } from "./sync-control";

function fakeSql() {
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("SELECT value FROM app_cache")) {
      const v = h.cache.get(String(values[0]));
      return Promise.resolve(v ? [{ value: v }] : []);
    }
    if (text.includes("INSERT INTO app_cache")) h.cache.set(String(values[0]), values[1]);
    return Promise.resolve([]);
  }) as never as ReturnType<typeof import("./db").getDb>;
  (tag as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => JSON.parse(JSON.stringify(v));
  return tag;
}

const synced = (title: string, remaining: number) => ({ status: "synced", remaining, workout: { title } });

let sql: ReturnType<typeof fakeSql>;
beforeEach(() => {
  h.cache.clear();
  h.results = [];
  h.lockFree = true;
  h.logged = [];
  sql = fakeSql();
});

describe("runChunk", () => {
  it("does nothing without a started run", async () => {
    expect(await runChunk(sql)).toEqual({ more: false });
  });

  it("syncs until the backlog is empty, then ends the run and logs it once", async () => {
    await startBackgroundSync(sql);
    h.results = [synced("A", 2), synced("B", 1), synced("C", 0)];
    expect(await runChunk(sql)).toEqual({ more: false });
    const s = await loadBackgroundSync(sql);
    expect(s.running).toBe(false);
    expect(s.loop).toMatchObject({ synced: 3, remaining: 0, done: true, message: "All caught up." });
    expect(h.logged).toEqual([{ synced: 3, skipped: 0, failed: 0, trigger: "background" }]);
  });

  it("hands over when the budget is spent, keeping the progress", async () => {
    await startBackgroundSync(sql);
    h.results = [synced("A", 5), synced("B", 4), synced("C", 3)];
    let t = 0;
    const out = await runChunk(sql, { budgetMs: 2, now: () => t++ });
    expect(out).toEqual({ more: true });
    const s = await loadBackgroundSync(sql);
    expect(s.running).toBe(true);
    expect(s.loop.synced).toBeGreaterThan(0);
    expect(h.logged).toEqual([]);
  });

  it("stops at the next workout after Stop", async () => {
    await startBackgroundSync(sql);
    await requestStop(sql);
    h.results = [synced("A", 3)];
    expect(await runChunk(sql)).toEqual({ more: false });
    const s = await loadBackgroundSync(sql);
    expect(s.running).toBe(false);
    expect(s.loop.message).toMatch(/Stopped after 0/);
    expect(h.results).toHaveLength(1); // nothing was uploaded after Stop
  });

  it("ends with the reason when Stop all syncing is on", async () => {
    await startBackgroundSync(sql);
    h.results = [new SyncStoppedError()];
    expect(await runChunk(sql)).toEqual({ more: false });
    expect((await loadBackgroundSync(sql)).loop.message).toMatch(/Syncing is stopped/);
  });

  it("ends on an error and says which workout", async () => {
    await startBackgroundSync(sql);
    h.results = [synced("A", 2), { status: "error", error: "Garmin said no", workout: { title: "Leg Day" }, remaining: 1 }];
    expect(await runChunk(sql)).toEqual({ more: false });
    const s = await loadBackgroundSync(sql);
    expect(s.loop).toMatchObject({ synced: 1, done: true, errorKind: "generic", message: "Leg Day: Garmin said no" });
    expect(h.logged).toEqual([{ synced: 1, skipped: 0, failed: 1, trigger: "background" }]);
  });

  it("leaves the run alone when another sync holds the lock", async () => {
    await startBackgroundSync(sql);
    h.lockFree = false;
    expect(await runChunk(sql)).toEqual({ more: false, busy: true });
    expect((await loadBackgroundSync(sql)).running).toBe(true);
  });
});

describe("isStale", () => {
  it("is true only for a running run that has not written for a while", async () => {
    const s = await startBackgroundSync(sql);
    const at = Date.parse(s.updatedAt!);
    expect(isStale(s, at + 1_000)).toBe(false);
    expect(isStale(s, at + 10 * 60_000)).toBe(true);
    expect(isStale({ ...s, running: false }, at + 10 * 60_000)).toBe(false);
  });

  it("keeps its state under one app_cache key", () => {
    expect(BACKGROUND_SYNC_KEY).toBe("background_sync");
  });
});
