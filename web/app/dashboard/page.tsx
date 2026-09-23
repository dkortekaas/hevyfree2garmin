import { getDb } from "@/lib/db";
import { loadGarminConnection } from "@/lib/connections";
import { loadImportSummary } from "@/lib/imported-workouts";
import { loadSyncControl, RUNNING, type SyncControl as SyncControlState } from "@/lib/sync-control";
import { SyncControl } from "@/components/sync-control";
import { SyncPanel } from "@/components/sync-panel";
import { PipelineDiagram } from "@/components/pipeline-diagram";
import { HEVY_TO_GARMIN } from "@/engine";

// Queries the live hevy2garmin Postgres per request — never at build time.
export const dynamic = "force-dynamic";

interface RecentWorkout {
  hevy_id: string;
  title: string;
  synced_at: string | null;
  calories: number;
  avg_hr: number | null;
  garmin_activity_id: string | null;
  status: string;
}

interface SyncLogEntry {
  id: number;
  time: string | null;
  synced: number;
  skipped: number;
  failed: number;
  trigger: string;
}

interface DashboardData {
  dbConfigured: boolean;
  /** Workouts imported from Hevy CSV exports; the sync's only source. */
  importedCount: number;
  garminConnected: boolean;
  totalSynced: number;
  syncedThisWeek: number;
  markedSynced: number;
  skipped: number;
  pending: number;
  recent: RecentWorkout[];
  syncLog: SyncLogEntry[];
  /** "Stop all syncing" (lib/sync-control). */
  syncControl: SyncControlState;
}

const EMPTY: DashboardData = {
  dbConfigured: false,
  importedCount: 0,
  garminConnected: false,
  totalSynced: 0,
  syncedThisWeek: 0,
  markedSynced: 0,
  skipped: 0,
  pending: 0,
  recent: [],
  syncLog: [],
  syncControl: RUNNING,
};

async function loadDashboard(): Promise<DashboardData> {
  let sql: ReturnType<typeof getDb>;
  try {
    sql = getDb();
  } catch {
    return EMPTY;
  }

  // Every query is guarded so a missing/empty table degrades to a sane default
  // rather than crashing the whole page render.
  const [garminConn, counts, recent, syncLog, pendingRow, hevyImport, syncControl] = await Promise.all([
    loadGarminConnection(sql),
    sql`
      SELECT
        count(*) FILTER (WHERE COALESCE(status, 'success') = 'success')::int AS total,
        count(*) FILTER (
          WHERE COALESCE(status, 'success') = 'success'
            AND synced_at >= (now() - interval '7 days')
        )::int AS week,
        count(*) FILTER (WHERE status = 'manual')::int AS marked,
        count(*) FILTER (WHERE status = 'skipped')::int AS skipped
      FROM synced_workouts
    `.catch(() => [] as Array<{ total: number; week: number; marked: number; skipped: number }>),
    sql`
      SELECT hevy_id, title, synced_at, calories, avg_hr,
             garmin_activity_id, COALESCE(status, 'success') AS status
      FROM synced_workouts
      ORDER BY synced_at DESC
      LIMIT 10
    `.catch(() => [] as RecentWorkout[]),
    sql`
      SELECT id, time, synced, skipped, failed, trigger
      FROM sync_log
      ORDER BY id DESC
      LIMIT 10
    `.catch(() => [] as SyncLogEntry[]),
    sql`SELECT count(*)::int AS n FROM pending_uploads`.catch(() => [] as Array<{ n: number }>),
    loadImportSummary(sql),
    loadSyncControl(sql),
  ]);

  return {
    dbConfigured: true,
    importedCount: hevyImport.count,
    garminConnected:
      garminConn.connected || recent.some((r) => r.garmin_activity_id != null),
    totalSynced: counts[0]?.total ?? 0,
    syncedThisWeek: counts[0]?.week ?? 0,
    markedSynced: counts[0]?.marked ?? 0,
    skipped: counts[0]?.skipped ?? 0,
    pending: pendingRow[0]?.n ?? 0,
    recent: recent.map((r) => ({
      hevy_id: r.hevy_id,
      title: r.title ?? "",
      synced_at: r.synced_at ?? null,
      calories: Number(r.calories) || 0,
      avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null,
      garmin_activity_id: r.garmin_activity_id ?? null,
      status: r.status,
    })),
    syncLog: syncLog.map((r) => ({
      id: Number(r.id),
      time: r.time ?? null,
      synced: Number(r.synced) || 0,
      skipped: Number(r.skipped) || 0,
      failed: Number(r.failed) || 0,
      trigger: r.trigger ?? "manual",
    })),
    syncControl,
  };
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ConnectionBadge({
  label,
  connected,
  detail,
  missing,
}: {
  label: string;
  connected: boolean;
  /** Replaces "Connected", e.g. "12 imported" for the CSV import. */
  detail?: string;
  /** Replaces "Not connected". */
  missing?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-surface px-3 py-2.5 border border-border md:px-4 md:py-3">
      <span
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
          connected ? "bg-success" : "bg-danger"
        }`}
        aria-hidden
      />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-text">{label}</span>
        <span className={`text-xs ${connected ? "text-success" : "text-text-muted"}`}>
          {connected ? (detail ?? "Connected") : (missing ?? "Not connected")}
        </span>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="rounded-xl bg-surface-elevated border border-border p-3 md:p-5">
      <div className="text-[11px] uppercase tracking-wide text-text-muted md:text-xs">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums md:text-3xl ${accent}`}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: "bg-success/15 text-success",
    manual: "bg-warm/15 text-warm",
    skipped: "bg-surface-active text-text-muted",
    failed: "bg-danger/15 text-danger",
  };
  const cls = styles[status] ?? "bg-surface-active text-text-secondary";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export default async function DashboardPage() {
  const data = await loadDashboard();
  // "Stop all syncing" disables the sync buttons along with the uploads behind them.
  const hasImport = data.importedCount > 0;
  const syncReady = hasImport && data.garminConnected && !data.syncControl.stopped;
  // Said out loud, because a greyed-out button with a hover hint that names the wrong cause
  // (it always said "Connect Hevy and Garmin first") is how "Delete all workouts", which
  // leaves syncing stopped, looked like a broken Sync all.
  const syncBlockedReason = data.syncControl.stopped
    ? "Syncing is stopped. Click Resume syncing above to upload to Garmin again."
    : !hasImport && !data.garminConnected
      ? "Import a Hevy CSV export and connect Garmin on the Setup page first."
      : !hasImport
        ? "No Hevy workouts yet: import a CSV export on the Setup page."
        : !data.garminConnected
          ? "Garmin isn't connected: connect it on the Setup page."
          : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text">Sync status</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Your Hevy workouts flowing into Garmin Connect.
        </p>
      </header>

      {!data.dbConfigured && (
        <div className="mb-6 rounded-lg border border-warm/40 bg-warm/10 p-4 text-sm text-warm">
          No database is configured (DATABASE_URL is unset). Showing empty state.
        </div>
      )}

      {/* Connection badges */}
      <section className="mb-6 grid grid-cols-2 gap-2 md:gap-3">
        <ConnectionBadge
          label="Hevy CSV"
          connected={hasImport}
          detail={`${data.importedCount} imported`}
          missing="Nothing imported"
        />
        <ConnectionBadge label="Garmin Connect" connected={data.garminConnected} />
      </section>

      {data.dbConfigured && (!hasImport || !data.garminConnected) && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warm/40 bg-warm/10 p-4">
          <p className="text-sm text-warm">
            {!hasImport && !data.garminConnected
              ? "Import a Hevy CSV export and connect Garmin to start syncing."
              : !data.garminConnected
                ? "Garmin isn't connected — connect it to upload workouts."
                : "No Hevy workouts yet — upload a CSV export from the Hevy app."}
          </p>
          <a
            href="/setup"
            className="rounded-lg bg-warm/20 px-3 py-1.5 text-xs font-medium text-warm transition-colors hover:bg-warm/30"
          >
            {!data.garminConnected ? "Connect Garmin" : "Import CSV"} →
          </a>
        </div>
      )}

      {/* Stat cards */}
      <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:mb-8 md:gap-3">
        <StatCard label="On Garmin" value={data.totalSynced} accent="text-teal" />
        <StatCard label="Marked synced" value={data.markedSynced} accent="text-warm" />
        <StatCard label="Skipped" value={data.skipped} accent="text-text-muted" />
        <StatCard label="Pending" value={data.pending} accent="text-warm" />
        <StatCard label="Imported" value={data.importedCount} accent="text-teal" />
        <StatCard label="Synced this week" value={data.syncedThisWeek} accent="text-text-secondary" />
      </section>

      {data.dbConfigured && (
        <SyncControl stopped={data.syncControl.stopped} stoppedAt={data.syncControl.stoppedAt} />
      )}

      {/* Sync controls (preview is dry-run; live upload is gated) */}
      {data.dbConfigured && syncBlockedReason && (
        <p
          data-testid="sync-blocked-reason"
          className="mb-3 rounded-lg border border-warm/40 bg-warm/10 px-4 py-2 text-xs text-warm"
        >
          Sync buttons are disabled. {syncBlockedReason}
        </p>
      )}
      <SyncPanel ready={syncReady} blockedReason={syncBlockedReason} />

      <PipelineDiagram mappingCount={Object.keys(HEVY_TO_GARMIN).length} />

      {/* Recent synced workouts */}
      <section className="mb-6 md:mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text">Recent workouts</h2>
          {data.recent.length > 0 && (
            <a href="/history" className="text-xs font-medium text-teal underline">
              All →
            </a>
          )}
        </div>
        {data.recent.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted">
            No synced workouts yet.
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-elevated">
            {data.recent.map((w) => (
              <li
                key={w.hevy_id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text">
                    {w.title || "Untitled workout"}
                  </div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    {fmtDate(w.synced_at)}
                    {w.calories > 0 && <span> · {w.calories} kcal</span>}
                    {w.avg_hr != null && <span> · {w.avg_hr} bpm avg</span>}
                  </div>
                </div>
                <StatusPill status={w.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sync log */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">Sync log</h2>
        {data.syncLog.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted">
            No sync runs recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface-elevated">
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Trigger</th>
                  <th className="px-4 py-2 text-right font-medium">Synced</th>
                  <th className="px-4 py-2 text-right font-medium">Skipped</th>
                  <th className="px-4 py-2 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.syncLog.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2 text-text-secondary">{fmtDate(entry.time)}</td>
                    <td className="px-4 py-2 text-text-secondary">{entry.trigger}</td>
                    <td className="px-4 py-2 text-right text-success">{entry.synced}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{entry.skipped}</td>
                    <td
                      className={`px-4 py-2 text-right ${
                        entry.failed > 0 ? "text-danger" : "text-text-muted"
                      }`}
                    >
                      {entry.failed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
