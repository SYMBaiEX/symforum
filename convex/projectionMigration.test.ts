/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const universalRef = makeFunctionReference<
  "mutation",
  { limit?: number },
  { processed: number; done: boolean }
>("universalSearchProjection:backfill");
const postsRef = makeFunctionReference<
  "mutation",
  { limit?: number },
  { processed: number; done: boolean }
>("postDigests:backfillPostDigests");

test.each(["postDigests", "posts", "newsletterIssues"] as const)(
  "%s migration bounds body bytes and advances past a row larger than the page byte target",
  async (phase) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        const body = "x".repeat(800_000);
        if (phase === "newsletterIssues") {
          await ctx.db.insert("newsletterIssues", {
            slug: `large-${i}`,
            subject: `Large ${i}`,
            previewText: "Summary",
            body,
            status: "sent",
            createdAt: i,
            updatedAt: i,
          });
        } else {
          await ctx.db.insert("posts", {
            slug: `large-${i}`,
            title: `Large ${i}`,
            excerpt: "Summary",
            body,
            tags: [],
            status: "published",
            publishedAt: i,
            readingMinutes: 1,
            featured: false,
          });
        }
      }
      if (phase !== "postDigests") {
        await ctx.db.insert("optimizationMigrations", {
          key: "universal-search-projections-v1",
          status: "running",
          processed: 0,
          cursor: JSON.stringify({ phase, cursor: null }),
          updatedAt: 1,
        });
      }
    });
    vi.useFakeTimers();
    try {
      const ref = phase === "postDigests" ? postsRef : universalRef;
      expect(await t.mutation(ref, { limit: 50 })).toMatchObject({
        processed: 1,
        done: false,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const rows = await t.run(async (ctx) =>
        ctx.db
          .query(
            phase === "postDigests"
              ? "postDigests"
              : "universalSearchProjections",
          )
          .take(10),
      );
      expect(rows).toHaveLength(3);
      const state = await t.run(async (ctx) =>
        ctx.db
          .query("optimizationMigrations")
          .withIndex("by_key", (q) =>
            q.eq(
              "key",
              phase === "postDigests"
                ? "post-digests-v1"
                : "universal-search-projections-v1",
            ),
          )
          .unique(),
      );
      expect(state).toMatchObject({ status: "completed", processed: 3 });
    } finally {
      vi.useRealTimers();
    }
  },
);
