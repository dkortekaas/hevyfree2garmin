import type { getDb } from "./db";

type Sql = ReturnType<typeof getDb>;

export interface Connection {
  connected: boolean;
  connectedAt: string | null;
}

const DISCONNECTED: Connection = { connected: false, connectedAt: null };

/**
 * Which platform_credentials row means what (Hevy has none: its workouts come
 * from the CSV import in imported_workouts):
 *
 *   platform='garmin'        the Garmin email/password pair, written by the Python setup form only
 *   platform='garmin_tokens' the DI tokens, written by every Garmin login (Python and web)
 *
 * Garmin connectivity has to come from `garmin_tokens`. A web login writes only that row, so
 * pages that looked at `garmin` reported a working login as "Not connected" and stayed that way
 * until the user hand-copied the row (hevy2garmin#495).
 *
 * It also has to come from the stored token rather than the `status` column. DBTokenStore's
 * upsert sets status='active' on INSERT but not in its DO UPDATE branch, so a row first created
 * by anything else keeps the schema default 'disconnected' through every later login. Reading the
 * token itself is true whenever a sync would actually work, which is what the badge claims.
 *
 * Both token shapes count: 0.3+ nests the DI payload under `garmin_tokens`, older Python logins
 * wrote it flat. healGarminTokenRow migrates a flat row, but only during a sync.
 */
export async function loadGarminConnection(sql: Sql): Promise<Connection> {
  const rows = await sql`
    SELECT connected_at,
           (jsonb_exists(credentials -> 'garmin_tokens', 'di_token')
            OR jsonb_exists(credentials, 'di_token')) AS has_token
    FROM platform_credentials
    WHERE platform = 'garmin_tokens'
  `.catch(() => [] as Array<{ connected_at: string | null; has_token: boolean | null }>);
  const row = rows[0];
  if (!row?.has_token) return DISCONNECTED;
  return { connected: true, connectedAt: row.connected_at ?? null };
}
