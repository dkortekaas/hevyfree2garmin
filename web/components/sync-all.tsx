"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { initialLoopState, loopPercent, errorHint, type LoopState } from "@/lib/sync-loop";

/** What GET/POST /api/sync-background return (lib/background-sync). */
interface ServerState {
  running?: boolean;
  updatedAt?: string | null;
  loop?: LoopState;
  error?: string;
}

const POLL_MS = 2_000;
/** A finished run is still shown when the page opens this soon after it ended. */
const SHOW_FINISHED_MS = 15 * 60_000;

/**
 * "Sync all", run by the server (lib/background-sync) so it keeps going when
 * the page is closed or the phone locks. This hook only starts it, stops it
 * and polls its progress; opening the page later picks the progress up again.
 *
 * Starting is a real Garmin upload, so callers put start() behind an explicit
 * user action; the server also requires a session for it.
 */
export function useSyncAll() {
  const router = useRouter();
  const [loop, setLoop] = useState<LoopState>(initialLoopState);
  const [running, setRunning] = useState(false);
  const wasRunning = useRef(false);

  const apply = useCallback(
    (d: ServerState, fresh: boolean) => {
      const isRunning = Boolean(d.running);
      const ended = Date.parse(d.updatedAt ?? "");
      const recent = Number.isFinite(ended) && Date.now() - ended < SHOW_FINISHED_MS;
      if (d.loop && (isRunning || fresh || recent)) setLoop({ ...initialLoopState, ...d.loop });
      setRunning(isRunning);
      if (wasRunning.current && !isRunning && (d.loop?.synced ?? 0) > 0) router.refresh();
      wasRunning.current = isRunning;
    },
    [router],
  );

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/sync-background", { cache: "no-store" });
      if (res.ok) apply((await res.json()) as ServerState, false);
    } catch {
      // Offline for a moment; the next poll tries again.
    }
  }, [apply]);

  // Pick up a run started earlier, from this page or another.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the server's state on mount is the point
    void poll();
  }, [poll]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [running, poll]);

  async function start(): Promise<void> {
    setLoop({ ...initialLoopState, started: false });
    try {
      const res = await fetch("/api/sync-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const d = (await res.json().catch(() => ({}))) as ServerState;
      if (!res.ok) {
        setRunning(false);
        setLoop({
          ...initialLoopState,
          done: true,
          errorKind: res.status === 401 ? "unauthorized" : "generic",
          message: d.error ?? `Could not start the sync (${res.status}).`,
        });
        return;
      }
      apply(d, true);
    } catch (err) {
      setLoop({ ...initialLoopState, done: true, errorKind: "generic", message: err instanceof Error ? err.message : "Network error." });
    }
  }

  async function stop(): Promise<void> {
    try {
      await fetch("/api/sync-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
    } finally {
      void poll();
    }
  }

  return {
    loop,
    running,
    start,
    stop,
    reset: () => setLoop(initialLoopState),
  };
}

/** Progress bar, counts and outcome of a Sync all pass. Renders nothing before the first run. */
export function SyncAllProgress({ loop, running }: { loop: LoopState; running: boolean }) {
  if (!(running || loop.started || loop.done)) return null;
  const pct = loopPercent(loop);
  const onGarmin = loop.total > 0 ? loop.total - loop.remaining : loop.synced;
  return (
    <div className="mt-4" aria-live="polite" data-testid="sync-all-progress">
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
      {running && (
        <p className="mt-2 text-xs text-text-muted">
          Runs on the server: you can close this page or lock your phone, and come back to see the progress.
        </p>
      )}
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
