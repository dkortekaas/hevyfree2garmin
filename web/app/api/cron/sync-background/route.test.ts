import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ afterCalls: 0 }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {
    h.afterCalls++;
  },
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/background-sync", () => ({ runAndContinue: async () => {} }));

import { POST } from "./route";

const call = (auth?: string) =>
  POST(new Request("http://h/api/cron/sync-background", { method: "POST", headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  h.afterCalls = 0;
  process.env.CRON_SECRET = "s3cret";
});

describe("POST /api/cron/sync-background", () => {
  it("needs the CRON_SECRET bearer", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(h.afterCalls).toBe(0);
  });

  it("runs the next chunk after answering", async () => {
    expect((await call("Bearer s3cret")).status).toBe(202);
    expect(h.afterCalls).toBe(1);
  });

  it("refuses when no CRON_SECRET is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything")).status).toBe(401);
  });
});
