"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function fmtWhen(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * "Stop all syncing" / "Resume syncing" (lib/sync-control). Stopping ends any
 * running sync at its next workout and blocks every new one, including the
 * daily cron. Resuming lifts the block.
 */
export function SyncControl({ stopped, stoppedAt }: { stopped: boolean; stoppedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function set(next: boolean) {
    if (
      next &&
      !window.confirm(
        "Stop all syncing? Running syncs end after the workout they are on, and nothing new is uploaded to Garmin until you resume.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/sync-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopped: next }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setError(d.error ?? `Request failed (${res.status}).`);
        return;
      }
      setMsg(
        next
          ? "All syncing stopped."
          : "Syncing resumed.",
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="sync-control"
      className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
        stopped ? "border-danger/40 bg-danger/10" : "border-border bg-surface-elevated"
      }`}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text">{stopped ? "All syncing is stopped" : "Sync control"}</h3>
        <p className="mt-1 text-xs text-text-secondary">
          {stopped
            ? `Nothing is uploaded to Garmin until you resume${stoppedAt ? ` (stopped ${fmtWhen(stoppedAt)})` : ""}.`
            : "Stop every running and scheduled sync at once: dashboard, CSV import and the daily cron."}
        </p>
        {msg && <p className="mt-1 text-xs text-success">{msg}</p>}
        {error && (
          <p className="mt-1 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
      {stopped ? (
        <button
          type="button"
          onClick={() => set(false)}
          disabled={busy}
          className="rounded-lg bg-teal/20 px-4 py-2 text-sm font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50"
        >
          {busy ? "Working…" : "Resume syncing"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => set(true)}
          disabled={busy}
          className="rounded-lg border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {busy ? "Working…" : "Stop all syncing"}
        </button>
      )}
    </section>
  );
}
