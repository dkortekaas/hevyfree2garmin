/**
 * "Sync all" on the server, so it keeps going with the page closed.
 *
 * It used to be a loop in the browser: one /api/sync-one request per workout,
 * driven by the page. A phone suspends a page that is not on screen, so the
 * loop stopped the moment the user switched apps, and a long backlog never
 * finished unless someone stared at it.
 *
 * Now the server runs it in chunks. A chunk syncs workouts until its time
 * budget is spent (a serverless function has a hard maximum duration), then
 * asks for the next chunk by calling /api/cron/sync-background with the
 * CRON_SECRET bearer. Progress lives in app_cache under `background_sync`, so
 * any page that opens later shows where the run is.
 *
 * The counting is lib/sync-loop's reducer, the same one the browser loop used,
 * so the numbers and the error hints read exactly as before.
 */
import type { getDb } from "./db";
import { acquireSyncLock, recordSyncRun } from "@/engine";
import { postgresLockBackend } from "./sync-lock-store";
import { postgresSyncStore } from "./sync-store";
import { syncOneWorkout } from "./sync-one";
import { SyncStoppedError, SYNC_STOPPED_MESSAGE } from "./sync-control";
import { initialLoopState, stepLoop, type LoopState, type SyncOneLike } from "./sync-loop";

type Sql = ReturnType<typeof getDb>;

export const BACKGROUND_SYNC_KEY = "background_sync";

/** How long one chunk may sync before handing over. Well under the route's maxDuration. */
export const CHUNK_BUDGET_MS = 30_000;

/**
 * A running run whose last write is older than this has lost its chain (a
 * failed self-call, a deploy mid-run). Opening the dashboard picks it up again.
 */
export const STALE_AFTER_MS = 120_000;

/** Never more workouts than this in one run, so a misbehaving server cannot spin forever. */
const MAX_WORKOUTS = 500;

export interface BackgroundSync {
  running: boolean;
  /** The user pressed Stop; the next workout boundary ends the run. */
  stopRequested: boolean;
  startedAt: string | null;
  updatedAt: string | null;
  /** Workouts looked at so far, for the MAX_WORKOUTS cap. */
  attempts: number;
  loop: LoopState;
}

export const IDLE: BackgroundSync = {
  running: false,
  stopRequested: false,
  startedAt: null,
  updatedAt: null,
  attempts: 0,
  loop: initialLoopState,
};

/** Read the run. A missing row or a read failure reads as idle. */
export async function loadBackgroundSync(sql: Sql): Promise<BackgroundSync> {
  try {
    const rows = (await sql`
      SELECT value FROM app_cache WHERE key = ${BACKGROUND_SYNC_KEY} LIMIT 1
    `) as Array<{ value: unknown }>;
    const raw = rows[0]?.value;
    const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<BackgroundSync> | undefined;
    if (!v || typeof v !== "object") return IDLE;
    return { ...IDLE, ...v, loop: { ...initialLoopState, ...(v.loop ?? {}) } };
  } catch {
    return IDLE;
  }
}

export async function saveBackgroundSync(sql: Sql, state: BackgroundSync): Promise<BackgroundSync> {
  const value = { ...state, updatedAt: new Date().toISOString() };
  await sql`
    INSERT INTO app_cache (key, value, updated_at)
    VALUES (${BACKGROUND_SYNC_KEY}, ${sql.json(value)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  return value;
}

/** A run that says it is running but has not written anything for a while. */
export function isStale(state: BackgroundSync, now = Date.now()): boolean {
  if (!state.running) return false;
  const at = Date.parse(state.updatedAt ?? "");
  return !Number.isFinite(at) || now - at > STALE_AFTER_MS;
}

/** Start a fresh run. The caller then runs the first chunk. */
export async function startBackgroundSync(sql: Sql): Promise<BackgroundSync> {
  return saveBackgroundSync(sql, {
    ...IDLE,
    running: true,
    startedAt: new Date().toISOString(),
  });
}

/** Ask a running run to stop at the next workout. */
export async function requestStop(sql: Sql): Promise<BackgroundSync> {
  const state = await loadBackgroundSync(sql);
  if (!state.running) return state;
  return saveBackgroundSync(sql, { ...state, stopRequested: true });
}

export interface ChunkOutcome {
  /** Another chunk should follow. */
  more: boolean;
  /** Someone else holds the sync lock; this chunk did nothing. */
  busy?: boolean;
}

export interface ChunkOptions {
  budgetMs?: number;
  now?: () => number;
}

/**
 * Sync workouts until the budget is spent, the backlog is empty, an error, or
 * Stop. Holds the sync lock throughout, so two chunks of one run (a delayed
 * self-call next to a stale-run pickup) or a run and the cron never upload at
 * once.
 */
export async function runChunk(sql: Sql, options: ChunkOptions = {}): Promise<ChunkOutcome> {
  const budgetMs = options.budgetMs ?? CHUNK_BUDGET_MS;
  const now = options.now ?? Date.now;
  const t0 = now();

  let state = await loadBackgroundSync(sql);
  if (!state.running) return { more: false };

  const lock = await acquireSyncLock({ backend: postgresLockBackend(sql), key: "sync" });
  if (!lock) return { more: false, busy: true };

  try {
    while (now() - t0 < budgetMs) {
      // Re-read each time: Stop is written by another request.
      const fresh = await loadBackgroundSync(sql);
      if (fresh.stopRequested) {
        const s = state.loop.synced + state.loop.skipped;
        state = await finish(sql, state, { message: `Stopped after ${s} workout(s).` });
        return { more: false };
      }
      if (state.attempts >= MAX_WORKOUTS) {
        state = await finish(sql, state, { message: `Stopped after ${MAX_WORKOUTS} workouts; press Sync all to continue.` });
        return { more: false };
      }

      let httpStatus = 200;
      let result: SyncOneLike;
      try {
        result = (await syncOneWorkout(sql, { dryRun: false })) as SyncOneLike;
      } catch (err) {
        if (err instanceof SyncStoppedError) {
          state = await finish(sql, state, { message: SYNC_STOPPED_MESSAGE });
          return { more: false };
        }
        httpStatus = 500;
        result = { error: err instanceof Error ? err.message : String(err) };
      }

      const { state: loop, cont } = stepLoop(state.loop, { httpStatus, result });
      state = { ...state, attempts: state.attempts + 1, loop };
      if (!cont) {
        state = await finish(sql, state, {});
        return { more: false };
      }
      state = await saveBackgroundSync(sql, state);
    }
    return { more: true };
  } finally {
    await lock.release();
  }
}

/** End the run and log it as one Sync log row, the way the browser loop did. */
async function finish(
  sql: Sql,
  state: BackgroundSync,
  patch: { message?: string },
): Promise<BackgroundSync> {
  const loop: LoopState = { ...state.loop, done: true, message: patch.message ?? state.loop.message };
  const ended = await saveBackgroundSync(sql, { ...state, running: false, stopRequested: false, loop });
  await recordSyncRun(
    postgresSyncStore(sql),
    { synced: loop.synced, skipped: loop.skipped, failed: loop.errorKind ? 1 : 0 },
    "background",
  );
  return ended;
}

/**
 * Ask this deployment to run the next chunk. Needs CRON_SECRET, which the
 * continuation route checks. Without it the run pauses after this chunk and
 * resumes when a dashboard is open (see isStale).
 *
 * Awaited, with a short timeout: the called route answers as soon as it has
 * scheduled its chunk, so this returns quickly, and a function that ended
 * before the request left would silently break the chain.
 */
export async function requestNextChunk(origin: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  try {
    const res = await fetch(`${origin}/api/cron/sync-background`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** One chunk, then hand over if there is more. What `after()` runs. */
export async function runAndContinue(sql: Sql, origin: string): Promise<void> {
  try {
    const { more } = await runChunk(sql);
    if (more) await requestNextChunk(origin);
  } catch (err) {
    // Never leave a run marked running after a crash: end it and say why.
    const state = await loadBackgroundSync(sql);
    if (state.running) {
      await finish(
        sql,
        { ...state, loop: { ...state.loop, errorKind: "generic" } },
        { message: err instanceof Error ? err.message : String(err) },
      ).catch(() => {});
    }
  }
}
