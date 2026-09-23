import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { loadSyncControl, setSyncStopped } from "@/lib/sync-control";
import { verifySession, SESSION_COOKIE, authEnabled } from "@/lib/auth";

// Reads/writes app_cache at request time — never at build.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET  /api/sync-control → { stopped, stoppedAt }
 * POST /api/sync-control   body { stopped: boolean }
 *
 * "Stop all syncing" (lib/sync-control). Stopping sets the switch, which every
 * upload path checks (dashboard, import, cron), so a batch or loop already
 * running ends at its next workout. Resuming clears it.
 */

async function authorized(): Promise<boolean> {
  if (!authEnabled()) return true;
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value ?? null);
}

export async function GET() {
  try {
    return NextResponse.json(await loadSyncControl(getDb()));
  } catch {
    return NextResponse.json({ stopped: false, stoppedAt: null });
  }
}

export async function POST(request: Request) {
  if (!(await authorized())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { stopped?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.stopped !== "boolean") {
    return NextResponse.json({ ok: false, error: "Body must be { stopped: true | false }." }, { status: 400 });
  }

  let sql: ReturnType<typeof getDb>;
  try {
    sql = getDb();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `DB unavailable: ${error}` }, { status: 503 });
  }

  let control;
  try {
    control = await setSyncStopped(sql, body.stopped);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `Could not save: ${error}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...control });
}
