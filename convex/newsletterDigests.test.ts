/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

describe("newsletter issue digests", () => {
  test("preserves archive output while removing full bodies from list reads", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("newsletterIssues", {
        slug: "digest-test",
        subject: "Digest subject",
        previewText: "Digest preview",
        body: JSON.stringify({ invalid: "legacy-safe-fallback" }),
        edition: "daily-signal",
        status: "sent",
        sentAt: 100,
        createdAt: 50,
        updatedAt: 100,
      });
    });

    const before = await t.query(api.newsletter.listPublicIssues, {
      limit: 10,
    });
    expect(before[0]).toMatchObject({
      headline: "Digest subject",
      dek: "Digest preview",
      sourceCount: 0,
    });
    expect(before[0]).not.toHaveProperty("body");

    await t.mutation(
      internal.newsletterDigests.backfillNewsletterIssueDigests,
      {},
    );
    const after = await t.query(api.newsletter.listPublicIssues, { limit: 10 });
    expect(after).toEqual(before);
    await t.run(async (ctx) => {
      expect(
        await ctx.db.query("newsletterIssueDigests").take(10),
      ).toHaveLength(1);
    });
  });

  test("persists its cursor and schedules every remaining routing batch", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < 45; index += 1) {
        await ctx.db.insert("newsletterIssues", {
          slug: `routing-${index}`,
          subject: `Routing ${index}`,
          previewText: "Preview",
          body: JSON.stringify({ invalid: true }),
          status: "sent",
          createdAt: index,
          updatedAt: index,
        });
      }
    });

    const first = await t.mutation(
      internal.newsletterDigests.backfillNewsletterIssueDigests,
      { limit: 20 },
    );
    expect(first).toMatchObject({ processed: 20, done: false });
    const second = await t.mutation(
      internal.newsletterDigests.backfillNewsletterIssueDigests,
      { cursor: first.cursor ?? undefined, limit: 20 },
    );
    expect(second).toMatchObject({ processed: 20, done: false });
    // A delayed duplicate still carrying page one's cursor must resume from
    // the newer persisted cursor instead of rereading page two.
    await expect(
      t.mutation(internal.newsletterDigests.backfillNewsletterIssueDigests, {
        cursor: first.cursor ?? undefined,
        limit: 20,
      }),
    ).resolves.toMatchObject({ processed: 5, done: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await t.run(async (ctx) => {
      expect(
        await ctx.db.query("newsletterIssueDigests").take(100),
      ).toHaveLength(45);
      const state = await ctx.db
        .query("optimizationMigrations")
        .withIndex("by_key", (q) =>
          q.eq("key", "newsletter-digests-v2-routing"),
        )
        .unique();
      expect(state).toMatchObject({ status: "completed", processed: 45 });
      expect(state?.cursor).toBeUndefined();
      expect(state?.scheduledAt).toBeUndefined();
    });
    vi.useRealTimers();
  });
});
