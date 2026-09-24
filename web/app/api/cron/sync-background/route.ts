import { NextResponse, after } from "next/server";
import { getDb } from "@/lib/db";
import { runAndContinue } from "@/lib/background-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/cron/sync-background — the next chunk of a background "Sync all"
 * (lib/background-sync). Called by the previous chunk with the CRON_SECRET
 * bearer; lives under /api/cron because that call carries no session cookie.
 * Answers at once and syncs after the response, so the caller is not held.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const m = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!secret || !m || m[1] !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  let sql: ReturnType<typeof getDb>;
  try {
    sql = getDb();
  } catch {
    return NextResponse.json({ ok: false, error: "No database configured." }, { status: 503 });
  }
  const origin = new URL(request.url).origin;
  after(() => runAndContinue(sql, origin));
  return NextResponse.json({ ok: true }, { status: 202 });
}
