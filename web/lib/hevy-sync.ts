/**
 * The workout source for every sync path: the workouts imported from a Hevy
 * CSV export (lib/hevy-csv.ts, stored by lib/imported-workouts.ts).
 *
 * This module only reads. It never touches Garmin and never uploads a FIT; the
 * upload half of the pipeline lives in the engine, behind the sync's own
 * dry-run default and duplicate checks.
 */
import { getDb } from "./db";
import { loadImportedWorkouts } from "./imported-workouts";

/** What a sync says when there is nothing imported to read. */
export const NO_IMPORT_MESSAGE =
  "No Hevy CSV imported yet. Export your workouts from Hevy and upload the CSV on the Setup page.";

/**
 * READ-only: every imported workout, newest first.
 *
 * Throws when nothing is imported, so a sync reports a clear "import a CSV
 * first" instead of a silent "nothing to sync".
 */
export async function fetchAllWorkouts(): Promise<HevyWorkout[]> {
  let imported: HevyWorkout[] = [];
  try {
    imported = (await loadImportedWorkouts(getDb())) as HevyWorkout[];
  } catch {
    // No database: same answer as an empty import.
  }
  if (!imported.length) throw new Error(NO_IMPORT_MESSAGE);
  return imported;
}

/**
 * The subset of a Hevy workout the sync side reads. The CSV import stores the
 * same JSON shape the Hevy app uses; only `id` is required for dedup, the rest
 * is best-effort display.
 */
export interface HevyWorkout {
  id: string;
  title?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  updated_at?: string | null;
  // The stored workout carries additional fields we don't type here.
  [key: string]: unknown;
}
