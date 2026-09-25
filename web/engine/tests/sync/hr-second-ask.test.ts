import { describe, it, expect, vi } from "vitest";
import { syncOneWorkout } from "../../sync";
import { MemoryStore, mockGateway, WORKOUT } from "./helpers";

/**
 * The daily HR feed lags by hours, so an empty first answer is worth a second
 * ask only for a workout that just ended (#600). For a backfill of older
 * workouts the second ask was one more Garmin call per workout, for nothing.
 */
async function dailyHrCalls(endedAgoMs: number): Promise<number> {
  const end = new Date(Date.now() - endedAgoMs);
  const start = new Date(end.getTime() - 3600_000);
  const workout = { ...WORKOUT, start_time: start.toISOString(), end_time: end.toISOString() };
  const gw = { ...mockGateway(), dailyHeartRate: vi.fn(async (_d: string) => ({ heartRateValues: [] })) };
  await syncOneWorkout(
    { store: new MemoryStore(), gateway: async () => gw, fetchWorkouts: async () => [workout] } as never,
    { dryRun: false, hrFusion: true },
  );
  return gw.dailyHeartRate.mock.calls.length;
}

describe("the second daily-HR ask", () => {
  it("happens for a workout that ended recently", async () => {
    expect(await dailyHrCalls(3600_000)).toBe(2);
  });

  it("is skipped for an older workout", async () => {
    expect(await dailyHrCalls(10 * 24 * 3600_000)).toBe(1);
  });
});
