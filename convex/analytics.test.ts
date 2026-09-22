/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";

import schema from "./schema";
import { api } from "./_generated/api";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const cleanupExpired = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { cutoff: number; deleted: number; hasMore: boolean }
>("analytics:cleanupExpired");

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

describe("analytics retention", () => {
  test("exposes only aggregate capture health in the admin summary", async () => {
    const t = setup();
    const adminId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          name: "Admin",
          username: "admin",
          usernameNormalized: "admin",
          role: "admin",
        }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("analyticsDailyMetrics", {
        date: "2026-08-31",
        captured: 8,
        droppedRateLimited: 2,
        updatedAt: 1,
      });
    });

    await expect(
      t.withIdentity({ subject: adminId }).query(api.analytics.summaryAdmin, {
        days: 1,
        now: Date.parse("2026-08-31T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      capture: { captured: 8, droppedRateLimited: 2, captureRatio: 0.8 },
    });
  });

  test("deletes only bounded events older than ninety days", async () => {
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("analyticsEvents", {
        name: "page_view",
        source: "client",
        createdAt: now - 91 * 24 * 60 * 60 * 1_000,
      });
      await ctx.db.insert("analyticsEvents", {
        name: "page_view",
        source: "client",
        createdAt: now - 89 * 24 * 60 * 60 * 1_000,
      });
    });

    await expect(t.mutation(cleanupExpired, {})).resolves.toMatchObject({
      deleted: 1,
      hasMore: false,
    });
    await t.run(async (ctx) => {
      const remaining = await ctx.db.query("analyticsEvents").collect();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.createdAt).toBe(now - 89 * 24 * 60 * 60 * 1_000);
    });
    vi.useRealTimers();
  });

  test("enforces one anonymous global budget despite varied visitor IDs", async () => {
    const t = setup();
    const results = [];
    for (let index = 0; index < 60; index += 1) {
      results.push(
        await t.mutation(api.analytics.record, {
          name: "page_view",
          visitorId: `visitor-${index}`,
          sessionId: `session-${index}`,
          path: `/path-${index}`,
        }),
      );
    }

    const captured = results.filter((result) => result.recorded).length;
    const dropped = results.length - captured;
    expect(captured).toBeGreaterThan(0);
    expect(captured).toBeLessThanOrEqual(30);
    expect(dropped).toBeGreaterThan(0);
    expect(
      results.some(
        (result) =>
          !result.recorded &&
          "reason" in result &&
          result.reason === "RATE_LIMITED",
      ),
    ).toBe(true);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("analyticsEvents").collect()).toHaveLength(
        captured,
      );
      expect(
        await ctx.db.query("analyticsDailyMetrics").collect(),
      ).toMatchObject([{ captured, droppedRateLimited: dropped }]);
    });
  });
});
