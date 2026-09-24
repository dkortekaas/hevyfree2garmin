import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { verifySession, SESSION_COOKIE, authEnabled } from "@/lib/auth";
import { isSyncStopped, SYNC_STOPPED_MESSAGE } from "@/lib/sync-control";
import {
  isStale,
  loadBackgroundSync,
  requestStop,
  runAndContinue,
  startBackgroundSync,
} from "@/lib/background-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The first chunk runs in `after()`, inside this function's lifetime.
export const maxDuration = 60;

/**
 * GET  /api/sync-background → the run's state (lib/background-sync).
 * POST /api/sync-background   body { action: "start" | "stop" }
 *
 * "Sync all" on the server. Start answers at once and runs the first chunk
 * after the response; later chunks chain through /api/cron/sync-background.
 * A GET that finds a run gone quiet (its chain broke) picks it up again, so an
 * open dashboard is enough to get a stuck run moving.
 */

async function authorized(): Promise<boolean> {
  if (!authEnabled()) return true;
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value ?? null);
}

function db() {
  try {
    return getDb();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const sql = db();
  if (!sql) return NextResponse.json({ error: "No database configured." }, { status: 503 });
  const state = await loadBackgroundSync(sql);
  if (isStale(state) && (await authorized())) {
    const origin = new URL(request.url).origin;
    after(() => runAndContinue(sql, origin));
  }
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  if (!(await authorized())) {
    return NextResponse.json({ error: "Sign in to sync." }, { status: 401 });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ error: "No database configured." }, { status: 503 });

  let body: { action?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // An empty body means start.
  }
  const action = body.action ?? "start";

  if (action === "stop") return NextResponse.json(await requestStop(sql));
  if (action !== "start") return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  if (await isSyncStopped(sql)) {
    return NextResponse.json({ error: SYNC_STOPPED_MESSAGE, stopped: true }, { status: 423 });
  }
  const current = await loadBackgroundSync(sql);
  if (current.running && !isStale(current)) {
    // Already going: answer with its progress rather than starting a second run.
    return NextResponse.json(current);
  }

  const state = await startBackgroundSync(sql);
  const origin = new URL(request.url).origin;
  after(() => runAndContinue(sql, origin));
  return NextResponse.json(state, { status: 202 });
}
