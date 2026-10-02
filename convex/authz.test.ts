/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import presenceTest from "@convex-dev/presence/test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "interactionScores");
  aggregateTest.register(t, "interactionSaves");
  aggregateTest.register(t, "commentCounts");
  registerRateLimiter(t);
  presenceTest.register(t);
  return t;
}

async function seedAccessFixture(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = 1_800_000_000_000;
    const ownerId = await ctx.db.insert("users", {
      name: "Owner",
      username: "owner",
      usernameNormalized: "owner",
      role: "owner",
    });
    const adminId = await ctx.db.insert("users", {
      name: "Administrator",
      username: "administrator",
      usernameNormalized: "administrator",
      role: "admin",
    });
    const readerId = await ctx.db.insert("users", {
      name: "Reader",
      username: "reader",
      usernameNormalized: "reader",
      role: "reader",
      emailVerificationTime: 1_800_000_000_000,
    });
    const publishedFeaturedId = await ctx.db.insert("posts", {
      slug: "published-featured",
      title: "Published featured post",
      excerpt: "A published post that is safe for public readers.",
      body: "This published body is available to public readers.",
      tags: ["auth"],
      status: "published",
      publishedAt: now,
      readingMinutes: 4,
      featured: true,
    });
    const draftFeaturedId = await ctx.db.insert("posts", {
      slug: "draft-featured",
      title: "Draft featured post",
      excerpt: "A draft post that must stay inside the admin console.",
      body: "This draft body must never be returned by public queries.",
      tags: ["private"],
      status: "draft",
      publishedAt: now + 10_000,
      readingMinutes: 3,
      featured: true,
    });
    const draftProjectId = await ctx.db.insert("portfolioProjects", {
      slug: "confidential-project",
      name: "Confidential project",
      type: "Private",
      role: "Owner",
      timeframe: "Future",
      summary: "This draft project must stay out of public portfolio data.",
      problem: "Private problem",
      approach: "Private approach",
      outcome: "Private outcome",
      status: "draft",
      order: 1,
      tags: ["private"],
    });

    return {
      adminId,
      draftFeaturedId,
      draftProjectId,
      ownerId,
      publishedFeaturedId,
      readerId,
    };
  });
}

describe("site authorization boundaries", () => {
  test("site admins can operate content while owner-only controls remain isolated", async () => {
    const t = setup();
    const seed = await seedAccessFixture(t);
    const asAdmin = t.withIdentity({
      subject: seed.adminId,
      name: "Administrator",
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });
    const asReader = t.withIdentity({
      subject: seed.readerId,
      name: "Reader",
    });

    await expect(t.query(api.admin.overview, {})).rejects.toThrow(
      /sign in to continue/i,
    );
    await expect(asReader.query(api.admin.overview, {})).rejects.toThrow(
      /administrator access/i,
    );
    await expect(asAdmin.query(api.admin.overview, {})).resolves.toMatchObject({
      user: { _id: seed.adminId, role: "admin" },
    });

    await expect(
      asAdmin.mutation(api.admin.upsertPost, {
        post: {
          title: "Administrator managed post",
          excerpt: "Administrators can safely manage editorial content.",
          body: "This is enough body copy to satisfy post validation.",
          tags: ["operations"],
          status: "draft",
          publishedAt: 1_800_000_100_000,
          readingMinutes: 5,
          featured: false,
        },
      }),
    ).resolves.toMatchObject({
      slug: "administrator-managed-post",
      status: "draft",
    });

    await expect(asAdmin.query(api.admin.listUsers, {})).rejects.toThrow(
      /owner access/i,
    );
    await expect(asAdmin.query(api.admin.listApiKeys, {})).rejects.toThrow(
      /owner access/i,
    );
    await expect(asOwner.query(api.admin.listUsers, {})).resolves.toHaveLength(
      3,
    );
  });

  test("public queries never return unpublished rows", async () => {
    const t = setup();
    const seed = await seedAccessFixture(t);

    await expect(t.query(api.posts.featured, {})).resolves.toMatchObject({
      _id: seed.publishedFeaturedId,
      slug: "published-featured",
      status: "published",
    });
    await expect(
      t.query(api.posts.getBySlug, { slug: "draft-featured" }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.siteContent.listPortfolioProjects, {}),
    ).resolves.toEqual([]);
  });

  test("comments and interactions require a real public target row", async () => {
    const t = setup();
    const seed = await seedAccessFixture(t);
    const asReader = t.withIdentity({
      subject: seed.readerId,
      name: "Reader",
    });

    await expect(
      t.query(api.comments.list, {
        entityType: "post",
        entityId: "draft-featured",
      }),
    ).rejects.toThrow(/not available/i);
    await expect(
      t.query(api.interactions.summary, {
        entityType: "post",
        entityId: "missing-post",
      }),
    ).rejects.toThrow(/not available/i);
    await expect(
      asReader.mutation(api.comments.add, {
        entityType: "post",
        entityId: "published-featured",
        body: "This comment belongs only to the signed-in reader.",
      }),
    ).resolves.toBeNull();
    await expect(
      asReader.mutation(api.interactions.set, {
        entityType: "post",
        entityId: "published-featured",
        vote: 1,
        saved: true,
      }),
    ).resolves.toBeNull();

    const rows = await t.run(async (ctx) => {
      const comments = await ctx.db.query("comments").collect();
      const interactions = await ctx.db.query("interactions").collect();
      return { comments, interactions };
    });
    expect(rows.comments).toMatchObject([
      {
        userId: seed.readerId,
        entityId: "published-featured",
      },
    ]);
    expect(rows.interactions).toMatchObject([
      {
        userId: seed.readerId,
        entityId: "published-featured",
        vote: 1,
        saved: true,
      },
    ]);

    await t.run(async (ctx) => {
      await ctx.db.insert("comments", {
        userId: seed.readerId,
        entityType: "post",
        entityId: "draft-featured",
        body: "This historical draft comment must not reach public profiles.",
        status: "active",
        createdAt: 1_800_000_200_000,
      });
    });
    const profile = await t.query(api.users.publicProfile, {
      username: "reader",
    });
    expect(profile?.recentComments).toHaveLength(1);
    expect(profile?.recentComments[0]?.entityId).toBe("published-featured");
  });
});
