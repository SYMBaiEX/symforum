/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerBetterAuth } from "@convex-dev/better-auth/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import schema from "./schema";
import { components } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.UTC(2026, 9, 31, 12);
function setup() {
  const t = convexTest(schema, modules);
  registerBetterAuth(t);
  registerLimiter(t);
  return t;
}
type Test = ReturnType<typeof setup>;
function session(t: Test, ip = "192.0.2.8") {
  return t.fetch("/api/identity/get-session", {
    headers: { "x-forwarded-for": ip, origin: "https://www.symbaiex.com" },
  });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("CONVEX_SITE_URL", "https://strong-bee-384.convex.site");
  vi.stubEnv("IDENTITY_SITE_URL", "https://www.symbaiex.com");
  vi.stubEnv("BETTER_AUTH_ENABLED", "true");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "isolated-http-counter-test-secret-not-production",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected external transport");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("parallel same-IP get-session requests preserve the exact30 request admission and429 behavior", async () => {
  const t = setup();
  const results = await Promise.all(
    Array.from({ length: 40 }, () => session(t)),
  );
  expect(results.filter((r) => r.status === 200)).toHaveLength(30);
  expect(results.filter((r) => r.status === 429)).toHaveLength(10);
  for (const response of results.filter((r) => r.status === 429))
    expect(Number(response.headers.get("x-retry-after"))).toBe(60);
  expect(fetch).not.toHaveBeenCalled();
});

test("different trusted single-IP/path keys retain independent throttles without a new global bucket", async () => {
  const t = setup();
  const results = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      session(t, i % 2 ? "192.0.2.9" : "192.0.2.10"),
    ),
  );
  expect(results.every((r) => r.status === 200)).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

test("existing count/reset deadline remains authoritative; denied requests do not extend it", async () => {
  const t = setup();
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "rateLimit",
        data: { key: "192.0.2.8|/get-session", count: 30, lastRequest: NOW },
      },
    }),
  );
  vi.setSystemTime(NOW + 15_000);
  const denied = await session(t);
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get("x-retry-after"))).toBe(45);
  const before = await t.run((ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "rateLimit",
      where: [{ field: "key", value: "192.0.2.8|/get-session" }],
    }),
  );
  expect(before).toMatchObject({ count: 30, lastRequest: NOW });
  vi.setSystemTime(NOW + 60_000);
  expect((await session(t)).status).toBe(200);
  expect(
    await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "rateLimit",
        where: [{ field: "key", value: "192.0.2.8|/get-session" }],
      }),
    ),
  ).toMatchObject({ count: 1, lastRequest: NOW + 60_000 });
  expect(fetch).not.toHaveBeenCalled();
});

test("the existing sign-in custom five-request rule is not raised or bypassed", async () => {
  const t = setup();
  const results: Response[] = [];
  for (let i = 0; i < 6; i++)
    results.push(
      await t.fetch("/api/identity/sign-in/email", {
        method: "POST",
        headers: {
          "x-forwarded-for": "192.0.2.11",
          origin: "https://www.symbaiex.com",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
  expect(results.slice(0, 5).every((r) => r.status === 400)).toBe(true);
  expect(results[5].status).toBe(429);
  expect(Number(results[5].headers.get("x-retry-after"))).toBe(60);
  expect(fetch).not.toHaveBeenCalled();
});
