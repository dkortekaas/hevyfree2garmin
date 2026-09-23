/**
 * The web app creates its own schema on first database use (#475).
 *
 * Without it, a brand-new Neon database rendered every page (reads degrade to
 * empty) and 500'd on every write ("relation app_cache does not exist"). Every
 * statement is `IF NOT EXISTS`, so running them against a populated database
 * is a no-op. A database from the original hevy2garmin keeps its extra
 * routine tables; nothing here reads or drops them.
 *
 * Runs once per process: `getDb()` makes every query wait on the memoised
 * promise, so the first write cannot race the CREATEs. It never rejects; on
 * failure it logs and lets the real query report the real error, the same
 * contract as normalizeGarminTokenRow.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS synced_workouts (
     hevy_id TEXT PRIMARY KEY,
     garmin_activity_id TEXT,
     title TEXT,
     synced_at TIMESTAMPTZ DEFAULT NOW(),
     calories INTEGER,
     avg_hr INTEGER,
     status VARCHAR(20) DEFAULT 'success'
   )`,
  `CREATE TABLE IF NOT EXISTS sync_log (
     id BIGSERIAL PRIMARY KEY,
     time TIMESTAMPTZ DEFAULT NOW(),
     synced INTEGER DEFAULT 0,
     skipped INTEGER DEFAULT 0,
     failed INTEGER DEFAULT 0,
     trigger VARCHAR(50) DEFAULT 'manual'
   )`,
  `CREATE TABLE IF NOT EXISTS hr_cache (
     hevy_id TEXT PRIMARY KEY,
     data JSONB NOT NULL,
     cached_at TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS pending_uploads (
     hevy_id TEXT PRIMARY KEY,
     phase TEXT NOT NULL,
     next_step TEXT,
     upload_id TEXT,
     garmin_activity_id TEXT,
     watch_activity_id TEXT,
     pre_upload_ids JSONB NOT NULL DEFAULT '[]',
     payload JSONB NOT NULL DEFAULT '{}',
     resolution_source TEXT,
     attempt_count INTEGER NOT NULL DEFAULT 0,
     delete_attempt_count INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     locked_until TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS platform_credentials (
     platform VARCHAR(50) PRIMARY KEY,
     auth_type VARCHAR(20) NOT NULL DEFAULT 'oauth',
     credentials JSONB NOT NULL DEFAULT '{}',
     connected_at TIMESTAMPTZ,
     expires_at TIMESTAMPTZ,
     status VARCHAR(20) DEFAULT 'disconnected'
   )`,
  `CREATE TABLE IF NOT EXISTS custom_mappings (
     hevy_name TEXT PRIMARY KEY,
     category INTEGER NOT NULL,
     subcategory INTEGER NOT NULL DEFAULT 0
   )`,
  // Columns added after the first release; a database bootstrapped by an older
  // Python build lacks them. Idempotent.
  `ALTER TABLE synced_workouts ADD COLUMN IF NOT EXISTS hevy_updated_at TEXT`,
  `ALTER TABLE synced_workouts ADD COLUMN IF NOT EXISTS sync_method TEXT DEFAULT 'upload'`,
  `ALTER TABLE synced_workouts ADD COLUMN IF NOT EXISTS resolution_reason TEXT`,
  `ALTER TABLE synced_workouts ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`,
  `ALTER TABLE synced_workouts ADD COLUMN IF NOT EXISTS resolution_source TEXT`,
  `CREATE TABLE IF NOT EXISTS app_cache (
     key TEXT PRIMARY KEY,
     value JSONB NOT NULL,
     updated_at TIMESTAMPTZ DEFAULT NOW()
   )`,
  // Workouts imported from a Hevy CSV export (lib/imported-workouts.ts).
  `CREATE TABLE IF NOT EXISTS imported_workouts (
     hevy_id TEXT PRIMARY KEY,
     start_time TIMESTAMPTZ,
     data JSONB NOT NULL,
     imported_at TIMESTAMPTZ DEFAULT NOW()
   )`,
];

/** Every table the app creates; the CI empty-database job asserts on them. */
export const SCHEMA_TABLES = [
  "synced_workouts", "sync_log", "hr_cache", "pending_uploads", "platform_credentials",
  "custom_mappings", "app_cache", "imported_workouts",
] as const;

/** A raw-SQL runner: postgres.js `client.unsafe(text)`. */
export type UnsafeRunner = { unsafe: (text: string) => Promise<unknown> };

let ready: Promise<boolean> | null = null;

/**
 * Run the schema statements once per process. Resolves true when every
 * statement ran, false when one failed (already logged). Never rejects.
 */
export function ensureSchema(db: UnsafeRunner): Promise<boolean> {
  if (ready) return ready;
  ready = (async () => {
    for (const text of SCHEMA_STATEMENTS) {
      try {
        await db.unsafe(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[schema] ${text.split("\n")[0].trim()} failed: ${msg}`);
        return false;
      }
    }
    return true;
  })();
  return ready;
}

/** Tests only. */
export function resetSchemaForTests(): void {
  ready = null;
}
