/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";

import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const cleanupExpired = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { cutoff: number; deleted: number; hasMore: boolean }
>("analytics:cleanupExpired");

describe("analytics retention", () => {
  test("deletes only bounded events older than ninety days", async () => {
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const t = convexTest(schema, modules);
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
});
