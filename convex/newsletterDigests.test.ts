/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
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
});
