import { NextResponse } from "next/server";
import { listCandidates } from "@/lib/sync-one";
import { getDb } from "@/lib/db";
import { demoMode } from "@/lib/demo";

// Reads live Hevy + the local ledger at request time — never at build.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/candidates
 *
 * Returns the unsynced imported workouts — everything that would be a sync candidate
 * (dedup layer 1). READ-ONLY: no Garmin call, no upload, no DB write. The
 * workouts page uses it to show a "to sync" list with a per-workout Sync button.
 */
export async function GET() {
  // The demo has no import, so this call can only fail, and its failure would
  // read as an error on a page where nothing is wrong (#634).
  if (demoMode()) return NextResponse.json({ candidates: [], demo: true });

  let sql: ReturnType<typeof getDb>;
  try {
    sql = getDb();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `DB unavailable: ${error}`, candidates: [] }, { status: 503 });
  }

  try {
    const candidates = await listCandidates(sql);
    return NextResponse.json({ candidates });
  } catch (err) {
    // Nothing imported (or a database hiccup) should degrade gracefully, not
    // 500 the whole page — surface the message and an empty list.
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error, candidates: [] }, { status: 200 });
  }
}
