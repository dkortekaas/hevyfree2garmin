import { describe, it, expect, vi, beforeEach } from "vitest";

/** POST /api/sync-control: the stop switch every upload path checks. */

const h = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
}));

vi.mock("@/lib/auth", () => ({ authEnabled: () => false, verifySession: async () => true, SESSION_COOKIE: "s" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    const tag = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("SELECT value FROM app_cache")) {
        const key = text.includes("'auto_sync'") ? "auto_sync" : String(values[0]);
        return Promise.resolve(h.cache.has(key) ? [{ value: h.cache.get(key) }] : []);
      }
      if (text.includes("INSERT INTO app_cache")) {
        if (text.includes("'auto_sync'")) h.cache.set("auto_sync", values[0]);
        else h.cache.set(String(values[0]), values[1]);
      }
      return Promise.resolve([]);
    }) as never;
    (tag as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
    return tag;
  },
}));

import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://h/api/sync-control", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  h.cache.clear();
});

describe("/api/sync-control", () => {
  it("stops syncing", async () => {
    const d = await (await post({ stopped: true })).json();
    expect(d).toMatchObject({ ok: true, stopped: true });
    expect(h.cache.get("sync_control")).toMatchObject({ stopped: true });
    expect((await (await GET()).json()).stopped).toBe(true);
  });

  it("resuming clears the switch", async () => {
    await post({ stopped: true });
    const d = await (await post({ stopped: false })).json();
    expect(d).toMatchObject({ ok: true, stopped: false });
    expect((await (await GET()).json()).stopped).toBe(false);
  });

  it("rejects a body without a boolean", async () => {
    expect((await post({ stopped: "yes" })).status).toBe(400);
  });
});
