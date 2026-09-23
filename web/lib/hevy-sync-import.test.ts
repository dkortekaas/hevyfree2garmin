import { describe, it, expect, vi, beforeEach } from "vitest";

/** fetchAllWorkouts reads the Hevy CSV import, and says so when there is none. */

const h = vi.hoisted(() => ({ imported: [] as unknown[] }));

vi.mock("./db", () => ({
  getDb: () => {
    const tag = ((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("FROM imported_workouts")) return Promise.resolve(h.imported.map((data) => ({ data })));
      return Promise.resolve([]);
    }) as never;
    (tag as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
    return tag;
  },
}));

import { fetchAllWorkouts } from "./hevy-sync";

const ids = (ws: unknown[]) => ws.map((w) => (w as { id: string }).id);

beforeEach(() => {
  h.imported = [];
});

describe("fetchAllWorkouts", () => {
  it("returns the imported workouts", async () => {
    h.imported = [
      { id: "csv-20240120T1800", start_time: "2024-01-20T17:00:00+00:00" },
      { id: "csv-20240115T1830", start_time: "2024-01-15T17:30:00+00:00" },
    ];
    expect(ids(await fetchAllWorkouts())).toEqual(["csv-20240120T1800", "csv-20240115T1830"]);
  });

  it("says what is missing when nothing is imported", async () => {
    await expect(fetchAllWorkouts()).rejects.toThrow(/No Hevy CSV imported/);
  });
});
