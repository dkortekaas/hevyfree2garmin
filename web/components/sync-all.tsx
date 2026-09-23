"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  initialLoopState,
  stepLoop,
  loopPercent,
  errorHint,
  type LoopState,
  type SyncOneLike,
} from "@/lib/sync-loop";

/**
 * Append a "Sync all" pass to the dashboard's Sync log.
 *
 * Best-effort on purpose: the sync itself already happened, and failing to
 * write a log row must not be reported to the user as a failed sync. The loop
 * has no `failed` counter of its own, because it stops on the first error
 * rather than counting them, so an error ends the run with whatever it had
 * plus one failure.
 */
async function recordRun(state: LoopState): Promise<void> {
  try {
    await fetch("/api/sync-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        synced: state.synced,
        skipped: state.skipped,
        failed: state.errorKind ? 1 : 0,
      }),
    });
  } catch {
    // The log is diagnostic. Losing a row is the lesser loss.
  }
}

/**
 * "Sync all": drives /api/sync-one?live=1 once per workout (lib/sync-loop)
 * until nothing is left, an error, or stop(). Shared by the dashboard's sync
 * card and the CSV import, which offers to upload what it just imported.
 *
 * Every call is a real Garmin upload, so callers put start() behind an
 * explicit user action; the server also requires authorization for ?live=1.
 */
export function useSyncAll() {
  const router = useRouter();
  const [loop, setLoop] = useState<LoopState>(initialLoopState);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  async function start(): Promise<LoopState> {
    setRunning(true);
    stopRef.current = false;
    let cur: LoopState = { ...initialLoopState };
    setLoop(cur);
    try {
      // Cap iterations defensively so a misbehaving server can't spin forever.
      for (let i = 0; i < 500; i++) {
        if (stopRef.current) {
          cur = { ...cur, done: true, message: `Paused after ${cur.synced + cur.skipped} workout(s).` };
          setLoop(cur);
          break;
        }
        let httpStatus = 0;
        let res: SyncOneLike = {};
        try {
          // batch=1: this loop posts ONE aggregate row to /api/sync-run when it
          // finishes, so the route must not also write a row per workout.
          const r = await fetch("/api/sync-one?live=1&batch=1", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ live: 1 }),
          });
          httpStatus = r.status;
          res = (await r.json().catch(() => ({}))) as SyncOneLike;
        } catch (err) {
          cur = { ...cur, done: true, errorKind: "generic", message: err instanceof Error ? err.message : "Network error." };
          setLoop(cur);
          break;
        }
        const { state: next, cont } = stepLoop(cur, { httpStatus, result: res });
        cur = next;
        setLoop(cur);
        if (!cont) break;
      }
    } finally {
      setRunning(false);
      // Record the whole pass as ONE row in the Sync log. A row per workout
      // would fill the panel with dozens of one-line entries (#611).
      await recordRun(cur);
      if (cur.synced > 0) router.refresh();
    }
    return cur;
  }

  return {
    loop,
    running,
    start,
    stop: () => {
      stopRef.current = true;
    },
    reset: () => setLoop(initialLoopState),
  };
}

/** Progress bar, counts and outcome of a Sync all pass. Renders nothing before the first run. */
export function SyncAllProgress({ loop, running }: { loop: LoopState; running: boolean }) {
  if (!(running || loop.started || loop.done)) return null;
  const pct = loopPercent(loop);
  const onGarmin = loop.total > 0 ? loop.total - loop.remaining : loop.synced;
  return (
    <div className="mt-4" aria-live="polite">
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-active">
        <div
          className="h-full rounded-full bg-teal transition-all duration-300"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-text-secondary">
        <span>On Garmin: <span className="font-semibold text-text">{onGarmin}</span></span>
        <span>Pending: <span className="font-semibold text-text">{loop.remaining}</span></span>
        <span>Synced: <span className="font-semibold text-success">{loop.synced}</span></span>
        {loop.skipped > 0 && <span>Skipped: <span className="font-semibold text-text-muted">{loop.skipped}</span></span>}
        {running && loop.currentTitle && <span className="min-w-0 truncate text-text-muted">· {loop.currentTitle}…</span>}
      </div>
      {loop.done && loop.message && (
        <p className={`mt-2 text-xs ${loop.errorKind ? "text-danger" : "text-text-secondary"}`} role={loop.errorKind ? "alert" : undefined}>
          {loop.errorKind ? errorHint(loop.errorKind) : loop.message}
        </p>
      )}
      {/* The hint alone ("Something went wrong") gave nothing to act on; the
          server's own message says which workout and what Garmin answered. */}
      {loop.done && loop.errorKind && loop.message && loop.message !== errorHint(loop.errorKind) && (
        <p className="mt-1 break-words text-xs text-text-muted" data-testid="sync-error-detail">
          {loop.message}
        </p>
      )}
    </div>
  );
}
