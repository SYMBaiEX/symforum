/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import { isLegacyEditorialThread } from "./forumAgentMaintenance";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

describe("forum agent maintenance", () => {
  test("recognizes only expired legacy editorial component threads", () => {
    const now = 1_800_000_000_000;
    const old = now - 2 * 24 * 60 * 60 * 1_000;
    const base = {
      _id: "legacy-thread",
      _creationTime: old,
      title: "suki editorial run 2026-01-01 / 12",
      summary: "Durable editorial memory for suki:2026-01-01:12",
    };

    expect(isLegacyEditorialThread(base, now - 24 * 60 * 60 * 1_000)).toBe(
      true,
    );
    expect(
      isLegacyEditorialThread(
        { ...base, _creationTime: now - 1_000 },
        now - 24 * 60 * 60 * 1_000,
      ),
    ).toBe(false);
    expect(
      isLegacyEditorialThread(
        { ...base, title: "User-authored conversation" },
        now - 24 * 60 * 60 * 1_000,
      ),
    ).toBe(false);
  });

  test("removes expired operational rows without deleting published forum content", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    const old = now - 40 * 24 * 60 * 60 * 1_000;
    const fresh = now - 2 * 24 * 60 * 60 * 1_000;
    const ids = await t.run(async (ctx) => {
      const authorId = await ctx.db.insert("users", {
        name: "Forum Agent",
        username: "forumagent",
        usernameNormalized: "forumagent",
      });
      const categoryId = await ctx.db.insert("forumCategories", {
        slug: "agent-lab",
        name: "Agent Lab",
        description: "Agent discussions",
        kind: "board",
        position: 1,
        status: "active",
        viewAccess: "public",
        threadAccess: "trusted",
        replyAccess: "trusted",
        pollAccess: "trusted",
        threadCount: 1,
        postCount: 1,
        createdAt: old,
        updatedAt: old,
      });
      const threadId = await ctx.db.insert("forumThreads", {
        categoryId,
        categorySlug: "agent-lab",
        slug: "durable-published-thread",
        title: "Durable published thread",
        body: "This published content must survive maintenance.",
        searchText:
          "Durable published thread This published content must survive maintenance.",
        authorId,
        status: "active",
        pinned: false,
        replyCount: 0,
        viewCount: 0,
        lastPostAt: old,
        lastPostUserId: authorId,
        createdAt: old,
        updatedAt: old,
      });
      const oldUsageId = await ctx.db.insert("forumAgentUsageEvents", {
        runKey: "suki:old:1",
        agentSlug: "suki",
        stage: "draft",
        model: "test/model",
        durationMs: 500,
        createdAt: old,
      });
      const freshUsageId = await ctx.db.insert("forumAgentUsageEvents", {
        runKey: "suki:fresh:1",
        agentSlug: "suki",
        stage: "draft",
        model: "test/model",
        durationMs: 500,
        createdAt: fresh,
      });
      const oldRunId = await ctx.db.insert("forumAgentRuns", {
        runKey: "suki:old:1",
        agentSlug: "suki",
        runDate: "2026-01-01",
        slot: 1,
        attempt: 1,
        status: "failed",
        model: "test/model",
        sourceUrls: [],
        startedAt: old,
        completedAt: old,
        updatedAt: old,
      });
      const referencedRunId = await ctx.db.insert("forumAgentRuns", {
        runKey: "suki:old:2",
        agentSlug: "suki",
        runDate: "2026-01-01",
        slot: 2,
        attempt: 1,
        status: "failed",
        model: "test/model",
        sourceUrls: [],
        workflowId: "workflow-needs-component-cleanup",
        startedAt: old,
        completedAt: old,
        updatedAt: old,
      });
      return {
        freshUsageId,
        oldRunId,
        oldUsageId,
        referencedRunId,
        threadId,
      };
    });

    const result = await t.mutation(
      internal.forumAgentMaintenanceData.cleanupExpiredOperationalData,
      { now },
    );

    expect(result).toMatchObject({
      deleted: 2,
      deletedAgentRuns: 1,
      deletedTelemetry: 1,
      continuing: false,
    });
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("forumAgentUsageEvents", ids.oldUsageId),
      ).toBeNull();
      expect(await ctx.db.get("forumAgentRuns", ids.oldRunId)).toBeNull();
      expect(
        await ctx.db.get("forumAgentUsageEvents", ids.freshUsageId),
      ).not.toBeNull();
      expect(
        await ctx.db.get("forumAgentRuns", ids.referencedRunId),
      ).not.toBeNull();
      expect(await ctx.db.get("forumThreads", ids.threadId)).toMatchObject({
        title: "Durable published thread",
        status: "active",
      });
    });
  });

  test("backfills compact thread digests and records the migration marker", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    const threadId = await t.run(async (ctx) => {
      const authorId = await ctx.db.insert("users", {
        name: "Author",
        username: "author",
        usernameNormalized: "author",
      });
      const categoryId = await ctx.db.insert("forumCategories", {
        slug: "ai-frameworks",
        name: "AI Frameworks",
        description: "Framework discussions",
        kind: "board",
        position: 1,
        status: "active",
        viewAccess: "public",
        threadAccess: "trusted",
        replyAccess: "trusted",
        pollAccess: "trusted",
        threadCount: 1,
        postCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("forumThreads", {
        categoryId,
        categorySlug: "ai-frameworks",
        slug: "compact-digest",
        title: "Compact digest",
        body: "A deliberately long post body that should not be duplicated into the digest.",
        searchText: "Compact digest A deliberately long post body",
        authorId,
        status: "active",
        pinned: false,
        replyCount: 3,
        viewCount: 25,
        lastPostAt: now,
        lastPostUserId: authorId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.mutation(internal.forumThreadDigestBackfill.run, {}),
    ).resolves.toEqual({ processed: 1, done: true });

    await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("forumThreadEditorialDigests")
        .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
        .unique();
      expect(digest).toMatchObject({
        threadId,
        threadCreatedAt: expect.any(Number),
        categorySlug: "ai-frameworks",
        title: "Compact digest",
        pinned: false,
        replyCount: 3,
        viewCount: 25,
      });
      expect(digest).not.toHaveProperty("body");
      expect(
        await ctx.db
          .query("forumAgentMaintenanceState")
          .withIndex("by_key", (q) => q.eq("key", "forum-thread-digests-v2"))
          .unique(),
      ).toMatchObject({ key: "forum-thread-digests-v2" });
    });
  });

  test("expires private reply-sweep telemetry without touching public content", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    const oldEventId = await t.run(async (ctx) =>
      await ctx.db.insert("forumAgentReplySweepEvents", {
        agentSlug: "suki",
        runDate: "2026-01-01",
        outcome: "route-failed",
        detail: "old provider timeout",
        createdAt: now - 36 * 24 * 60 * 60 * 1_000,
      }),
    );
    const result = await t.mutation(
      internal.forum.cleanupForumReplySweepTelemetry,
      { now },
    );
    expect(result).toEqual({ deleted: 1, continuing: false });
    await t.run(async (ctx) => {
      expect(await ctx.db.get("forumAgentReplySweepEvents", oldEventId)).toBeNull();
    });
  });
});
