/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";

import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const record = makeFunctionReference<
  "mutation",
  {
    route: string;
    name: "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
    value: number;
    rating: "good" | "needs-improvement" | "poor";
    navigationType: "navigate" | "reload" | "back-forward" | "prerender";
    timestamp: number;
  },
  { recorded: boolean; deduped: boolean }
>("webVitals:record");
const summaryAdmin = makeFunctionReference<
  "query",
  { days?: number; now?: number },
  {
    sampled: number;
    routes: Array<{
      route: string;
      name: string;
      samples: number;
      p50: number;
      p75: number;
      p95: number;
      passRate: number;
      budget: number;
    }>;
  }
>("webVitals:summaryAdmin");
const cleanupExpired = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { deletedEvents: number; deletedBuckets: number; hasMore: boolean }
>("webVitals:cleanupExpired");

describe("privacy-preserving Web Vitals", () => {
  test("records a bounded public template without identifiers and deduplicates it", async () => {
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const t = convexTest(schema, modules);
    const input = {
      route: "/blog/[slug]",
      name: "LCP" as const,
      value: 2_100,
      rating: "good" as const,
      navigationType: "navigate" as const,
      timestamp: now,
    };

    await expect(t.mutation(record, input)).resolves.toEqual({
      recorded: true,
      deduped: false,
    });
    await expect(t.mutation(record, input)).resolves.toEqual({
      recorded: false,
      deduped: true,
    });
    await expect(
      t.mutation(record, { ...input, route: "/admin/secret" }),
    ).resolves.toEqual({ recorded: false, deduped: false });
    await t.run(async (ctx) => {
      const events = await ctx.db.query("webVitalEvents").collect();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject(input);
      expect(events[0]).not.toHaveProperty("visitorId");
      expect(events[0]).not.toHaveProperty("userAgent");
      expect(events[0]).not.toHaveProperty("url");
    });
    vi.useRealTimers();
  });

  test("keeps percentile summaries admin-only and cleanup bounded", async () => {
    const now = 1_800_000_000_000;
    const t = convexTest(schema, modules);
    const ownerId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        name: "Owner",
        username: "owner",
        usernameNormalized: "owner",
        role: "owner",
      });
      for (const value of [100, 200, 300, 400]) {
        await ctx.db.insert("webVitalEvents", {
          route: "/",
          name: "INP",
          value,
          rating: "good",
          navigationType: "navigate",
          timestamp: now - value,
          dedupeKey: `inp-${value}`,
          createdAt: now - value,
        });
      }
      await ctx.db.insert("webVitalEvents", {
        route: "/",
        name: "LCP",
        value: 1_000,
        rating: "good",
        navigationType: "navigate",
        timestamp: now - 31 * 24 * 60 * 60 * 1_000,
        dedupeKey: "expired",
        createdAt: now - 31 * 24 * 60 * 60 * 1_000,
      });
      return id;
    });

    await expect(t.query(summaryAdmin, { now })).rejects.toThrow(/sign in/i);
    await expect(
      t.withIdentity({ subject: ownerId }).query(summaryAdmin, { now }),
    ).resolves.toMatchObject({
      sampled: 4,
      routes: [
        {
          route: "/",
          name: "INP",
          samples: 4,
          p50: 200,
          p75: 300,
          p95: 400,
          passRate: 0.5,
          budget: 200,
        },
      ],
    });
    vi.setSystemTime(now);
    await expect(t.mutation(cleanupExpired, {})).resolves.toMatchObject({
      deletedEvents: 1,
      hasMore: false,
    });
    vi.useRealTimers();
  });
});
