import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const syncOneWorkout = vi.fn();
vi.mock("@/lib/sync-one", () => ({ syncOneWorkout: (...a: unknown[]) => syncOneWorkout(...a) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
// The cron run now takes the sync lock, so a scheduled tick and a user
// pressing Sync cannot walk the same backlog at once (#604). Stubbed to
// "nothing in the way" here.
vi.mock("@/lib/sync-lock-store", () => ({ postgresLockBackend: () => ({}) }));
vi.mock("@/engine", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  acquireSyncLock: async () => ({ key: "sync", token: "t", release: async () => {} }),
}));

import { GET } from "./route";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://h/api/cron/sync", { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/cron/sync", () => {
  it("no CRON_SECRET configured → 401", async () => {
    const res = await GET(req({ authorization: "Bearer whatever" }));
    expect(res.status).toBe(401);
    expect(syncOneWorkout).not.toHaveBeenCalled();
  });

  it("wrong Bearer → 401", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET(req({ authorization: "Bearer nope" }));
    expect(res.status).toBe(401);
  });

  it("correct Bearer → inline loop until none, counts synced", async () => {
    process.env.CRON_SECRET = "s3cret";
    syncOneWorkout
      .mockResolvedValueOnce({ status: "synced" })
      .mockResolvedValueOnce({ status: "skipped" })
      .mockResolvedValueOnce({ status: "none" });
    const res = await GET(req({ authorization: "Bearer s3cret" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.mode).toBe("inline");
    expect(json.ran).toBe(2);
    expect(json.synced).toBe(1);
    // Unattended, so it waits out the grace period rather than beating the
    // watch's own activity to Garmin.
    expect(syncOneWorkout).toHaveBeenCalledWith(expect.anything(), { dryRun: false, respectGrace: true });
  });
});
