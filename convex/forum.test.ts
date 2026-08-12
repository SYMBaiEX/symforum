/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  buildForumNotificationEmail,
  forumNotificationEmailSubject,
  forumNotificationEmailUrl,
  type ForumNotificationEmailRenderContext,
} from "./forumNotificationEmails";
import {
  FORUM_REPLY_BODY_MAX_LENGTH,
  FORUM_THREAD_BODY_MAX_LENGTH,
} from "./forumLimits";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof setup>;

async function seedForum(t: TestBackend) {
  return await t.run(async (ctx) => {
    const now = 1_800_000_000_000;
    const ownerId = await ctx.db.insert("users", {
      name: "Owner",
      username: "owner",
      usernameNormalized: "owner",
      role: "owner",
      forumTrustedAt: now,
    });
    const trustedUserId = await ctx.db.insert("users", {
      name: "Trusted Author",
      username: "trustedauthor",
      usernameNormalized: "trustedauthor",
      contactEmail: "trusted@example.com",
      forumTrustedAt: now,
      forumTrustedBy: ownerId,
    });
    const otherTrustedUserId = await ctx.db.insert("users", {
      name: "Other Trusted",
      username: "othertrusted",
      usernameNormalized: "othertrusted",
      email: "other@example.com",
      forumTrustedAt: now,
      forumTrustedBy: ownerId,
    });
    const untrustedUserId = await ctx.db.insert("users", {
      name: "New Member",
      username: "newmember",
      usernameNormalized: "newmember",
    });
    const syntheticEmailUserId = await ctx.db.insert("users", {
      name: "Synthetic Email",
      username: "syntheticemail",
      usernameNormalized: "syntheticemail",
      email: "syntheticemail@users.symbaiex.local",
    });

    const publicCategoryId = await insertCategory(ctx, {
      slug: "public-square",
      name: "Public Square",
      viewAccess: "public",
      position: 10,
      now,
    });
    const trustedCategoryId = await insertCategory(ctx, {
      slug: "trusted-lab",
      name: "Trusted Lab",
      viewAccess: "trusted",
      position: 20,
      now,
    });

    const publicThreadId = await insertThread(ctx, {
      categoryId: publicCategoryId,
      categorySlug: "public-square",
      slug: "public-lunar-brief",
      title: "Public lunar brief",
      body: "Public members can read this lunar launch discussion.",
      authorId: trustedUserId,
      now: now + 1,
    });
    const trustedThreadId = await insertThread(ctx, {
      categoryId: trustedCategoryId,
      categorySlug: "trusted-lab",
      slug: "trusted-lunar-brief",
      title: "Trusted lunar brief",
      body: "Trusted members can read this lunar launch discussion.",
      authorId: trustedUserId,
      now: now + 2,
    });

    const publicPostId = await insertPost(ctx, {
      threadId: publicThreadId,
      categoryId: publicCategoryId,
      authorId: trustedUserId,
      body: "Public reply about lunar launch logs.",
      postNumber: 2,
      now: now + 3,
    });
    const trustedPostId = await insertPost(ctx, {
      threadId: trustedThreadId,
      categoryId: trustedCategoryId,
      authorId: trustedUserId,
      body: "Trusted reply about lunar launch logs.",
      postNumber: 2,
      now: now + 4,
    });

    return {
      ownerId,
      publicCategoryId,
      publicPostId,
      publicThreadId,
      trustedCategoryId,
      trustedPostId,
      trustedThreadId,
      trustedUserId,
      otherTrustedUserId,
      syntheticEmailUserId,
      untrustedUserId,
    };
  });
}

describe("forum notification preferences", () => {
  test("forum nav state reflects forum-specific staff roles and capabilities", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });
    const staff = await t.run(async (ctx) => {
      const siteAdminId = await ctx.db.insert("users", {
        name: "Site Admin",
        username: "siteadmin",
        usernameNormalized: "siteadmin",
        role: "admin",
      });
      const forumModeratorId = await ctx.db.insert("users", {
        name: "Forum Moderator",
        username: "forummod",
        usernameNormalized: "forummod",
        forumRole: "moderator",
        forumRoleAssignedAt: 1_800_000_000_010,
        forumRoleAssignedBy: seed.ownerId,
      });
      const forumAdminId = await ctx.db.insert("users", {
        name: "Forum Admin",
        username: "forumadmin",
        usernameNormalized: "forumadmin",
        forumRole: "admin",
        forumRoleAssignedAt: 1_800_000_000_011,
        forumRoleAssignedBy: seed.ownerId,
      });
      return { forumAdminId, forumModeratorId, siteAdminId };
    });
    const asSiteAdmin = t.withIdentity({
      subject: staff.siteAdminId,
      name: "Site Admin",
    });
    const asForumModerator = t.withIdentity({
      subject: staff.forumModeratorId,
      name: "Forum Moderator",
    });
    const asForumAdmin = t.withIdentity({
      subject: staff.forumAdminId,
      name: "Forum Admin",
    });
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    await expect(
      t.query(api.forum.getMyForumNavState, {}),
    ).resolves.toMatchObject({
      authenticated: false,
      trusted: false,
      canModerate: false,
      canAdmin: false,
      canManageBoards: false,
      username: null,
      rank: null,
      postCount: 0,
      reputationScore: 0,
    });
    await expect(
      asTrusted.query(api.forum.getMyForumNavState, {}),
    ).resolves.toMatchObject({
      authenticated: true,
      trusted: true,
      canModerate: false,
      canAdmin: false,
      canManageBoards: false,
      username: "trustedauthor",
      rank: "New Member",
      postCount: 0,
      reputationScore: 0,
    });
    await expect(
      asOwner.query(api.forum.getMyForumNavState, {}),
    ).resolves.toMatchObject({
      authenticated: true,
      trusted: true,
      canModerate: true,
      canAdmin: true,
      canManageBoards: true,
    });
    await expect(
      asSiteAdmin.query(api.forum.getMyForumNavState, {}),
    ).resolves.toMatchObject({
      authenticated: true,
      trusted: true,
      canModerate: true,
      canAdmin: true,
      canManageBoards: true,
    });
    await expect(
      asForumModerator.query(api.forum.getMyForumNavState, {}),
    ).resolves.toMatchObject({
      authenticated: true,
      trusted: true,
      canModerate: true,
      canAdmin: false,
      canManageBoards: false,
    });
    await expect(
      asForumAdmin.query(api.forum.getMyForumNavState, {}),
    ).resolves.toMatchObject({
      authenticated: true,
      trusted: true,
      canModerate: true,
      canAdmin: true,
      canManageBoards: true,
    });
  });

  test("forum moderators can moderate but cannot board-manage", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const moderatorId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Forum Moderator",
        username: "forummod",
        usernameNormalized: "forummod",
        forumRole: "moderator",
        forumRoleAssignedAt: 1_800_000_000_010,
        forumRoleAssignedBy: seed.ownerId,
      });
    });
    const asModerator = t.withIdentity({
      subject: moderatorId,
      name: "Forum Moderator",
    });

    await expect(
      asModerator.mutation(api.forum.updateForumThreadModeration, {
        threadId: seed.publicThreadId,
        pinned: true,
        moderationReason: "Feature useful launch context",
      }),
    ).resolves.toMatchObject({
      updated: true,
      thread: { _id: seed.publicThreadId, pinned: true },
    });

    await expect(
      asModerator.mutation(api.forum.upsertForumCategory, {
        slug: "moderator-board",
        name: "Moderator Board",
        status: "active",
        kind: "board",
        viewAccess: "public",
        threadAccess: "trusted",
        replyAccess: "trusted",
        pollAccess: "trusted",
      }),
    ).rejects.toThrow(/Forum admin access/);
  });

  test("board moderators are scoped to assigned boards", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const boardModeratorId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Board Moderator",
        username: "boardmod",
        usernameNormalized: "boardmod",
        forumTrustedAt: 1_800_000_000_020,
        forumTrustedBy: seed.ownerId,
      });
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });
    const asBoardModerator = t.withIdentity({
      subject: boardModeratorId,
      name: "Board Moderator",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await expect(
      asOwner.mutation(api.forum.assignCategoryModerator, {
        categoryId: seed.publicCategoryId,
        username: "boardmod",
      }),
    ).resolves.toMatchObject({
      assigned: true,
      moderator: { userId: boardModeratorId, username: "boardmod" },
      category: {
        _id: seed.publicCategoryId,
        moderators: [{ userId: boardModeratorId }],
      },
    });

    await expect(
      asBoardModerator.query(api.forum.getMyForumNavState, {}),
    ).resolves.toMatchObject({
      authenticated: true,
      trusted: true,
      canModerate: true,
      canAdmin: false,
      canManageBoards: false,
    });

    await expect(
      asBoardModerator.mutation(api.forum.updateForumThreadModeration, {
        threadId: seed.publicThreadId,
        pinned: true,
        moderationReason: "Pin assigned board context",
      }),
    ).resolves.toMatchObject({
      updated: true,
      thread: { _id: seed.publicThreadId, pinned: true },
    });
    await expect(
      asBoardModerator.mutation(api.forum.updateForumThreadModeration, {
        threadId: seed.trustedThreadId,
        pinned: true,
        moderationReason: "Should not escape assigned board",
      }),
    ).rejects.toThrow(/moderator access for this board/i);

    const publicReport = await asOtherTrusted.mutation(api.forum.createReport, {
      entityType: "thread",
      threadId: seed.publicThreadId,
      reason: "Needs assigned board review",
    });
    const trustedReport = await asOwner.mutation(api.forum.createReport, {
      entityType: "post",
      threadId: seed.trustedThreadId,
      postId: seed.trustedPostId,
      reason: "Needs trusted board review",
    });

    const threads = await asBoardModerator.query(api.forum.listForumThreads, {
      limit: 10,
    });
    expect(threads.map((thread) => thread._id)).toContain(seed.publicThreadId);
    expect(threads.map((thread) => thread._id)).not.toContain(
      seed.trustedThreadId,
    );

    const reports = await asBoardModerator.query(api.forum.listForumReports, {
      status: "open",
      limit: 10,
    });
    expect(reports.map((report) => report._id)).toContain(
      publicReport.reportId,
    );
    expect(reports.map((report) => report._id)).not.toContain(
      trustedReport.reportId,
    );

    await expect(
      asBoardModerator.mutation(api.forum.updateForumReportStatus, {
        reportId: publicReport.reportId,
        status: "reviewed",
        moderationNote: "Reviewed by assigned board moderator.",
      }),
    ).resolves.toMatchObject({
      updated: true,
      report: { _id: publicReport.reportId, status: "reviewed" },
    });
    await expect(
      asBoardModerator.mutation(api.forum.updateForumReportStatus, {
        reportId: trustedReport.reportId,
        status: "reviewed",
        moderationNote: "Should not review outside assigned board.",
      }),
    ).rejects.toThrow(/moderator access for this board/i);

    const overview = await asBoardModerator.query(api.forum.adminOverview, {});
    expect(overview.categories.map((category) => category._id)).toEqual([
      seed.publicCategoryId,
    ]);

    await expect(
      asBoardModerator.mutation(api.forum.moveForumThread, {
        threadId: seed.publicThreadId,
        targetCategoryId: seed.trustedCategoryId,
        moderationReason: "Cross-board moves remain global-only",
      }),
    ).rejects.toThrow(/Forum moderator access/);
    await expect(
      asBoardModerator.mutation(api.forum.upsertForumCategory, {
        slug: "board-mod-created",
        name: "Board Mod Created",
        status: "active",
        kind: "board",
        viewAccess: "public",
        threadAccess: "trusted",
        replyAccess: "trusted",
        pollAccess: "trusted",
      }),
    ).rejects.toThrow(/Forum admin access/);
  });

  test("moderation status transitions update counts, reports, and audit metadata once", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    const report = await asOtherTrusted.mutation(api.forum.createReport, {
      entityType: "post",
      threadId: seed.publicThreadId,
      postId: seed.publicPostId,
      reason: "Needs moderator review",
    });

    await expect(
      asOwner.mutation(api.forum.updateForumThreadModeration, {
        threadId: seed.publicThreadId,
        status: "hidden",
        moderationReason: "Hold for launch cleanup",
      }),
    ).resolves.toMatchObject({
      updated: true,
      thread: { _id: seed.publicThreadId, status: "hidden" },
    });
    await expect(
      asOwner.mutation(api.forum.updateForumThreadModeration, {
        threadId: seed.publicThreadId,
        status: "hidden",
        moderationReason: "Hold for launch cleanup",
      }),
    ).resolves.toMatchObject({ updated: false });

    await expect(
      asOwner.mutation(api.forum.updateForumPostModeration, {
        postId: seed.trustedPostId,
        status: "deleted",
        moderationReason: "Remove duplicate lab reply",
      }),
    ).resolves.toMatchObject({
      updated: true,
      post: { _id: seed.trustedPostId, status: "deleted" },
    });
    await expect(
      asOwner.mutation(api.forum.updateForumPostModeration, {
        postId: seed.trustedPostId,
        status: "deleted",
        moderationReason: "Remove duplicate lab reply",
      }),
    ).resolves.toMatchObject({ updated: false });

    await expect(
      asOwner.mutation(api.forum.updateForumReportStatus, {
        reportId: report.reportId,
        status: "reviewed",
        moderationNote: "Handled in status transition test.",
      }),
    ).resolves.toMatchObject({
      updated: true,
      report: {
        _id: report.reportId,
        status: "reviewed",
        moderationNote: "Handled in status transition test.",
      },
    });
    await expect(
      asOwner.mutation(api.forum.updateForumReportStatus, {
        reportId: report.reportId,
        status: "reviewed",
        moderationNote: "Handled in status transition test.",
      }),
    ).resolves.toMatchObject({ updated: false });

    const snapshot = await t.run(async (ctx) => {
      const [
        publicThread,
        publicCategory,
        trustedPost,
        trustedThread,
        trustedCategory,
        storedReport,
      ] = await Promise.all([
        ctx.db.get(seed.publicThreadId),
        ctx.db.get(seed.publicCategoryId),
        ctx.db.get(seed.trustedPostId),
        ctx.db.get(seed.trustedThreadId),
        ctx.db.get(seed.trustedCategoryId),
        ctx.db.get(report.reportId),
      ]);
      const [threadEvents, postEvents, reportEvents] = await Promise.all([
        ctx.db
          .query("forumModerationEvents")
          .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
            q
              .eq("entityType", "forumThread")
              .eq("entityId", seed.publicThreadId),
          )
          .take(10),
        ctx.db
          .query("forumModerationEvents")
          .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
            q.eq("entityType", "forumPost").eq("entityId", seed.trustedPostId),
          )
          .take(10),
        ctx.db
          .query("forumModerationEvents")
          .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
            q.eq("entityType", "forumReport").eq("entityId", report.reportId),
          )
          .take(10),
      ]);
      return {
        postEvents: postEvents.map((event) => ({
          ...event,
          metadata: JSON.parse(event.metadataJson),
        })),
        publicCategory,
        publicThread,
        reportEvents: reportEvents.map((event) => ({
          ...event,
          metadata: JSON.parse(event.metadataJson),
        })),
        storedReport,
        threadEvents: threadEvents.map((event) => ({
          ...event,
          metadata: JSON.parse(event.metadataJson),
        })),
        trustedCategory,
        trustedPost,
        trustedThread,
      };
    });

    expect(snapshot.publicThread).toMatchObject({
      status: "hidden",
      moderationReason: "Hold for launch cleanup",
    });
    expect(snapshot.publicCategory).toMatchObject({
      threadCount: 0,
      postCount: 0,
    });
    expect(snapshot.trustedPost).toMatchObject({
      status: "deleted",
      moderationReason: "Remove duplicate lab reply",
      deletedBy: seed.ownerId,
    });
    expect(snapshot.trustedThread).toMatchObject({ replyCount: 0 });
    expect(snapshot.trustedCategory).toMatchObject({ postCount: 1 });
    expect(snapshot.storedReport).toMatchObject({
      status: "reviewed",
      reviewedBy: seed.ownerId,
      moderationNote: "Handled in status transition test.",
    });

    expect(snapshot.threadEvents).toHaveLength(1);
    expect(snapshot.threadEvents[0]).toMatchObject({
      actorUserId: seed.ownerId,
      eventType: "forum_thread_moderated",
      metadata: {
        previousStatus: "active",
        nextStatus: "hidden",
        moderationReason: "Hold for launch cleanup",
      },
    });
    expect(snapshot.postEvents).toHaveLength(1);
    expect(snapshot.postEvents[0]).toMatchObject({
      actorUserId: seed.ownerId,
      eventType: "forum_post_deleted",
      metadata: {
        previousStatus: "active",
        nextStatus: "deleted",
        moderationReason: "Remove duplicate lab reply",
      },
    });
    expect(snapshot.reportEvents.map((event) => event.eventType)).toEqual([
      "forum_report_created",
      "forum_report_updated",
    ]);
    expect(snapshot.reportEvents[1]).toMatchObject({
      actorUserId: seed.ownerId,
      metadata: {
        previousStatus: "open",
        nextStatus: "reviewed",
        moderationNote: "Handled in status transition test.",
      },
    });
  });

  test("forum admin role enables board management without site admin role", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const forumAdminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Forum Admin",
        username: "forumadmin",
        usernameNormalized: "forumadmin",
        forumRole: "admin",
        forumRoleAssignedAt: 1_800_000_000_010,
        forumRoleAssignedBy: seed.ownerId,
      });
    });
    const asForumAdmin = t.withIdentity({
      subject: forumAdminId,
      name: "Forum Admin",
    });

    const category = await asForumAdmin.mutation(
      api.forum.upsertForumCategory,
      {
        slug: "forum-admin-board",
        name: "Forum Admin Board",
        status: "active",
        kind: "board",
        viewAccess: "public",
        threadAccess: "trusted",
        replyAccess: "trusted",
        pollAccess: "trusted",
      },
    );

    expect(category).toMatchObject({
      slug: "forum-admin-board",
      name: "Forum Admin Board",
    });
    await expect(
      asForumAdmin.query(api.forum.getMyForumNavState, {}),
    ).resolves.toMatchObject({
      canModerate: true,
      canAdmin: true,
      canManageBoards: true,
    });
  });

  test("owner can assign and clear forum staff roles and status limits clear forum staff", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const targetUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Forum Helper",
        username: "forumhelper",
        usernameNormalized: "forumhelper",
        role: "reader",
      });
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });

    const assigned = await asOwner.mutation(api.admin.updateUserForumRole, {
      userId: targetUserId,
      forumRole: "moderator",
    });
    expect(assigned).toMatchObject({
      _id: targetUserId,
      role: "reader",
      forumRole: "moderator",
      forumRoleAssignedBy: seed.ownerId,
    });

    const cleared = await asOwner.mutation(api.admin.updateUserForumRole, {
      userId: targetUserId,
      forumRole: null,
    });
    expect(cleared).toMatchObject({
      _id: targetUserId,
      role: "reader",
    });
    expect(cleared.forumRole).toBeUndefined();

    await asOwner.mutation(api.admin.updateUserForumRole, {
      userId: targetUserId,
      forumRole: "admin",
    });
    const presenceId = await t.run(async (ctx) => {
      return await ctx.db.insert("forumPresence", {
        userId: targetUserId,
        locationType: "index",
        path: "/forum",
        label: "Forum index",
        createdAt: 1_800_000_000_100,
        updatedAt: 1_800_000_000_100,
        lastSeenAt: 1_800_000_000_100,
      });
    });

    const suspended = await asOwner.mutation(api.admin.updateUserForumStatus, {
      userId: targetUserId,
      status: "suspended",
      reason: "Owner dashboard suspension",
      suspendedUntil: 1_800_000_100_000,
    });
    expect(suspended.forumRole).toBeUndefined();
    expect(suspended.forumSuspendedUntil).toBe(1_800_000_100_000);
    await expect(
      t.run(async (ctx) => await ctx.db.get(presenceId)),
    ).resolves.toBeNull();
  });

  test("forum default seed creates starter boards and old-school utility content idempotently", async () => {
    const t = setup();
    const ownerId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Owner",
        username: "owner",
        usernameNormalized: "owner",
        role: "owner",
      });
    });
    const asOwner = t.withIdentity({
      subject: ownerId,
      name: "Owner",
    });

    const first = await asOwner.mutation(
      api.forum.ensureDefaultForumCategories,
      {},
    );

    expect(first.created).toBe(true);
    expect(first.createdCategoryIds).toHaveLength(42);
    expect(first.createdPrefixIds).toHaveLength(8);
    expect(first.createdAnnouncementIds).toHaveLength(1);
    expect(first.createdHelpDocumentIds).toHaveLength(3);
    expect(first.createdBoardRulesIds).toHaveLength(3);

    const seeded = await t.run(async (ctx) => {
      const [categories, prefixes, announcements, helpDocuments, boardRules] =
        await Promise.all([
          ctx.db.query("forumCategories").withIndex("by_position").collect(),
          ctx.db
            .query("forumThreadPrefixes")
            .withIndex("by_position")
            .collect(),
          ctx.db.query("forumAnnouncements").withIndex("by_position").collect(),
          ctx.db
            .query("forumHelpDocuments")
            .withIndex("by_position_and_title")
            .collect(),
          ctx.db.query("forumBoardRules").withIndex("by_updatedAt").collect(),
        ]);
      return {
        announcementSlugs: announcements.map((row) => row.slug).sort(),
        categorySlugs: categories.map((row) => row.slug).sort(),
        helpSlugs: helpDocuments.map((row) => row.slug).sort(),
        prefixSlugs: prefixes.map((row) => row.slug).sort(),
        rulesTitles: boardRules.map((row) => row.title).sort(),
      };
    });

    expect(seeded.categorySlugs).toEqual([
      "ai",
      "ai-agents",
      "ai-frameworks",
      "ai-local",
      "ai-models",
      "ai-prompts",
      "ai-skills",
      "forum-news",
      "gaming",
      "gaming-downloads",
      "gaming-guides",
      "gaming-hacks",
      "gaming-hosting",
      "general",
      "general-help-feedback",
      "general-introductions",
      "general-lounge",
      "hacking",
      "hacking-ctf",
      "hacking-privacy-opsec",
      "hacking-reverse-engineering",
      "hacking-security-news",
      "hacking-tools",
      "hacking-web-security",
      "music",
      "music-gear",
      "music-new-releases",
      "music-playlists",
      "music-production",
      "music-scenes",
      "news-hacker-news",
      "projects",
      "projects-build-logs",
      "projects-collaboration",
      "projects-releases",
      "projects-show-tell",
      "research",
      "research-data",
      "research-experiments",
      "research-papers",
      "research-reading-list",
      "symbaiex",
    ]);
    expect(seeded.prefixSlugs).toEqual([
      "discussion",
      "guide",
      "news",
      "question",
      "release",
      "research",
      "resource",
      "showcase",
    ]);
    expect(seeded.announcementSlugs).toEqual(["welcome"]);
    expect(seeded.helpSlugs).toEqual([
      "accounts-and-private-messages",
      "moderation",
      "posting-guide",
    ]);
    expect(seeded.rulesTitles).toEqual([
      "General rules",
      "Projects rules",
      "Research rules",
    ]);

    const second = await asOwner.mutation(
      api.forum.ensureDefaultForumCategories,
      {},
    );

    expect(second.created).toBe(false);
    expect(second.categoryIds).toHaveLength(42);
    expect(second.createdCategoryIds).toHaveLength(0);
    expect(second.createdPrefixIds).toHaveLength(0);
    expect(second.createdAnnouncementIds).toHaveLength(0);
    expect(second.createdHelpDocumentIds).toHaveLength(0);
    expect(second.createdBoardRulesIds).toHaveLength(0);
  });

  test("Suki infrastructure is idempotent and publishes attributed forum topics", async () => {
    const t = setup();

    const first = await t.mutation(
      internal.forum.ensureSukiForumInfrastructure,
      {},
    );
    expect(first.createdCategoryIds).toHaveLength(42);
    expect(first.createdPrefixIds).toHaveLength(8);

    const second = await t.mutation(
      internal.forum.ensureSukiForumInfrastructure,
      {},
    );
    expect(second.agentUserId).toBe(first.agentUserId);
    expect(second.createdCategoryIds).toHaveLength(0);
    expect(second.createdPrefixIds).toHaveLength(0);

    const context = await t.query(internal.forum.readSukiForumContext, {});
    expect(context.agent).toMatchObject({
      dailyPostTarget: 24,
      enabled: true,
      model: "muse/Muse-Glimmer-30B",
      name: "Suki",
      slug: "suki",
    });
    expect(context.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Hacks",
          parentName: "Gaming",
          slug: "gaming-hacks",
        }),
        expect.objectContaining({
          name: "Prompts",
          parentName: "AI",
          slug: "ai-prompts",
        }),
      ]),
    );

    const claim = await t.mutation(internal.sukiForumAgentData.claimRun, {
      attempt: 0,
      runDate: "2026-07-28",
      slot: 0,
    });
    expect(claim.claimed).toBe(true);

    const published = await t.mutation(internal.forum.publishSukiForumThread, {
      body: [
        "[b]Why this matters[/b]",
        "A sourced release is more useful when the thread also gives readers a practical way to evaluate it.",
        "",
        "[b]What to check[/b]",
        "[list][*]Read the original notes.[*]Verify the documented tradeoffs.[*]Share a reproducible result.[/list]",
        "",
        "[chart=Evaluation signal]Evidence quality|90|Primary sources available\nReproducibility|70|Steps can be compared\nAdoption risk|35|Early field signal[/chart]",
        "",
        "[b]Sources and further reading[/b]",
        "[list][*][url=https://example.com/research]Primary research[/url] — Example Research[/list]",
      ].join("\n"),
      candidateCount: 12,
      categorySlug: "ai-prompts",
      inputTokens: 900,
      outputTokens: 500,
      poll: {
        question: "Which evaluation would help you most?",
        options: ["Quality", "Latency", "Cost"],
      },
      prefixSlug: "guide",
      runKey: claim.runKey,
      sources: [
        {
          sourceKey: "example-primary-source",
          sourceUrl: "https://example.com/research",
        },
      ],
      title: "A practical checklist for evaluating a new prompt technique",
    });
    expect(published.categorySlug).toBe("ai-prompts");

    const stored = await t.run(async (ctx) => {
      const [thread, run, source, profile, poll] = await Promise.all([
        ctx.db.get(published.threadId),
        ctx.db
          .query("forumAgentRuns")
          .withIndex("by_runKey", (q) => q.eq("runKey", claim.runKey))
          .unique(),
        ctx.db
          .query("forumAgentSourceUses")
          .withIndex("by_sourceKey", (q) =>
            q.eq("sourceKey", "example-primary-source"),
          )
          .unique(),
        ctx.db
          .query("forumUserProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", first.agentUserId))
          .unique(),
        ctx.db
          .query("forumPolls")
          .withIndex("by_threadId", (q) => q.eq("threadId", published.threadId))
          .unique(),
      ]);
      return { poll, profile, run, source, thread };
    });
    expect(stored.thread).toMatchObject({
      authorId: first.agentUserId,
      categorySlug: "ai-prompts",
      prefixSlug: "guide",
      status: "active",
    });
    expect(stored.run).toMatchObject({
      status: "published",
      threadId: published.threadId,
    });
    expect(stored.source?.threadId).toBe(published.threadId);
    expect(stored.profile).toMatchObject({
      customTitle: "Waifu Space Pirate",
      postCount: 1,
      threadCount: 1,
    });
    expect(stored.poll).toMatchObject({
      optionCount: 3,
      status: "open",
    });

    const duplicateClaim = await t.mutation(
      internal.sukiForumAgentData.claimRun,
      {
        attempt: 1,
        runDate: "2026-07-28",
        slot: 0,
      },
    );
    expect(duplicateClaim).toMatchObject({
      claimed: false,
      reason: "published",
    });

    await t.run(async (ctx) => {
      const agent = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) => q.eq("slug", "suki"))
        .unique();
      if (agent === null) {
        throw new Error("Expected Suki's agent record");
      }
      await ctx.db.patch(agent._id, { enabled: false });
    });
    await t.mutation(internal.forum.ensureSukiForumInfrastructure, {});
    const disabledClaim = await t.mutation(
      internal.sukiForumAgentData.claimRun,
      {
        attempt: 0,
        runDate: "2026-07-28",
        slot: 1,
      },
    );
    expect(disabledClaim).toMatchObject({
      claimed: false,
      reason: "disabled",
    });
  });

  test("Suki claims substantive human posts once and publishes a normal forum reply", async () => {
    const t = setup();
    const infrastructure = await t.mutation(
      internal.forum.ensureSukiForumInfrastructure,
      {},
    );
    const seeded = await t.run(async (ctx) => {
      const category = await ctx.db
        .query("forumCategories")
        .withIndex("by_slug", (q) => q.eq("slug", "ai-prompts"))
        .unique();
      if (category === null) {
        throw new Error("Expected the AI prompts board");
      }
      const now = Date.now() - 3 * 60 * 1_000;
      const authorId = await ctx.db.insert("users", {
        name: "Curious Human",
        username: "curioushuman",
        usernameNormalized: "curioushuman",
        forumTrustedAt: now,
      });
      const threadId = await insertThread(ctx, {
        categoryId: category._id,
        categorySlug: category.slug,
        slug: "debugging-a-repeatable-prompt",
        title: "Debugging a repeatable prompt",
        body: "My prompt works in the first run, but why does the structured result drift after the conversation grows?",
        authorId,
        now,
      });
      await ctx.db.patch(threadId, {
        replyCount: 0,
        lastAssignedPostNumber: 1,
      });
      const agent = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) => q.eq("slug", "suki"))
        .unique();
      if (agent === null) throw new Error("Expected Suki's agent record");
      const replyRunId = await ctx.db.insert("forumAgentReplyRuns", {
        runKey: `forum-reply:thread:${threadId}`,
        agentSlug: "suki",
        runDate: "2026-07-28",
        sourceKind: "thread",
        threadId,
        categoryId: category._id,
        authorId,
        attempt: -1,
        status: "queued",
        model: agent.model,
        reason: "event-queued",
        startedAt: now,
        updatedAt: now,
      });
      return { authorId, categoryId: category._id, replyRunId, threadId };
    });

    const claim = await t.mutation(
      internal.forum.claimSukiForumReplyCandidate,
      {
        attempt: 0,
        runDate: "2026-07-28",
        runId: seeded.replyRunId,
      },
    );
    if (!claim.claimed) {
      throw new Error(`Expected a candidate, received ${claim.reason}`);
    }
    expect(claim.candidate).toMatchObject({
      authorName: "curioushuman",
      sourceKind: "thread",
      threadId: seeded.threadId,
    });

    const published = await t.mutation(internal.forum.publishSukiForumReply, {
      runId: claim.runId,
      reason: "useful-technical-followup",
      body: `[b]Start with the changing input[/b]

[list]
[*]Log the complete prompt at each turn.
[*]Compare the schema and context window before changing the model.
[/list]`,
      inputTokens: 240,
      outputTokens: 90,
    });
    expect(published).toMatchObject({
      status: "replied",
      postNumber: 2,
    });

    const stored = await t.run(async (ctx) => {
      const [thread, category, run, profile] = await Promise.all([
        ctx.db.get(seeded.threadId),
        ctx.db.get(seeded.categoryId),
        ctx.db.get(claim.runId),
        ctx.db
          .query("forumUserProfiles")
          .withIndex("by_userId", (q) =>
            q.eq("userId", infrastructure.agentUserId),
          )
          .unique(),
      ]);
      const posts = await ctx.db
        .query("forumPosts")
        .withIndex("by_threadId_and_status_and_postNumber", (q) =>
          q.eq("threadId", seeded.threadId).eq("status", "active"),
        )
        .collect();
      return { category, posts, profile, run, thread };
    });
    expect(stored.thread).toMatchObject({
      lastPostUserId: infrastructure.agentUserId,
      replyCount: 1,
    });
    expect(stored.category?.postCount).toBe(1);
    expect(stored.posts).toEqual([
      expect.objectContaining({
        authorId: infrastructure.agentUserId,
        postNumber: 2,
      }),
    ]);
    expect(stored.profile?.postCount).toBe(1);
    expect(stored.run).toMatchObject({
      replyPostId: stored.posts[0]?._id,
      status: "replied",
    });

    await t.run(async (ctx) => {
      const now = Date.now() - 3 * 60 * 1_000;
      await insertThread(ctx, {
        categoryId: seeded.categoryId,
        categorySlug: "ai-prompts",
        slug: "definitely-not-spam",
        title: "Definitely not spam",
        body: "Crypto giveaway! DM me on Telegram @signal for a promo code.",
        authorId: seeded.authorId,
        now,
      });
    });
    const afterSpam = await t.mutation(
      internal.forum.claimSukiForumReplyCandidate,
      {
        attempt: 0,
        runDate: "2026-07-28",
      },
    );
    expect(afterSpam).toMatchObject({
      claimed: false,
      reason: "no-candidate",
    });
  });

  test("forum research excludes active source reservations before topic generation", async () => {
    const t = setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("forumAgentSourceReservations", {
        sourceKey: "reserved-source",
        runKey: "other:2026-08-12:0",
        agentSlug: "other",
        status: "reserved",
        reservedAt: now,
        expiresAt: now + 60_000,
        updatedAt: now,
      });
      await ctx.db.insert("forumAgentSourceReservations", {
        sourceKey: "expired-source",
        runKey: "other:2026-08-11:0",
        agentSlug: "other",
        status: "reserved",
        reservedAt: now - 120_000,
        expiresAt: now - 60_000,
        updatedAt: now - 60_000,
      });
    });

    const unavailable = await t.query(internal.forum.readUsedSukiSourceKeys, {
      sourceKeys: ["reserved-source", "expired-source", "free-source"],
    });
    expect(unavailable).toEqual(["reserved-source"]);
  });

  test("Belle infrastructure targets one digest plus six varied daily posts", async () => {
    const t = setup();
    const infrastructure = await t.mutation(
      internal.forum.ensureBelleForumInfrastructure,
      {},
    );
    const context = await t.query(internal.forum.readBelleForumContext, {});

    expect(context.agent).toMatchObject({
      dailyPostTarget: 7,
      enabled: true,
      model: "muse/Muse-Glimmer-30B",
      name: "Belle",
      slug: "belle",
    });
    expect(context.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Hacker News",
          parentName: "News",
          slug: "news-hacker-news",
        }),
      ]),
    );

    const claim = await t.mutation(internal.sukiForumAgentData.claimRun, {
      agentSlug: "belle",
      attempt: 0,
      runDate: "2026-07-28",
      slot: 0,
    });
    expect(claim.claimed).toBe(true);

    const published = await t.mutation(internal.forum.publishSukiForumThread, {
      agentSlug: "belle",
      body: [
        "[note]The Canary Desk connects today's reporting into one useful thread.[/note]",
        "[chart=Today's signal map]Research|92|Primary evidence\nInfrastructure|67|Adoption pressure\nCulture|44|Early movement[/chart]",
        "[h2]The story through it[/h2]",
        "The daily brief gives readers verified links, a concise summary, and a clearly labeled editorial interpretation.",
        "[b]Which signal deserves a deeper follow-up tomorrow?[/b]",
      ].join("\n\n"),
      candidateCount: 8,
      categorySlug: "news-hacker-news",
      prefixSlug: "news",
      runKey: claim.runKey,
      sources: [
        {
          sourceKey: "belle-hn-123-2026-07-28",
          sourceUrl: "https://example.com/hacker-news-story",
        },
      ],
      title: "Jul 28, 2026 — The infrastructure story hiding in plain sight",
    });

    const stored = await t.run(async (ctx) => {
      const [thread, profile] = await Promise.all([
        ctx.db.get(published.threadId),
        ctx.db
          .query("forumUserProfiles")
          .withIndex("by_userId", (q) =>
            q.eq("userId", infrastructure.agentUserId),
          )
          .unique(),
      ]);
      return { profile, thread };
    });
    expect(stored.thread).toMatchObject({
      authorId: infrastructure.agentUserId,
      categorySlug: "news-hacker-news",
      prefixSlug: "news",
    });
    expect(stored.profile).toMatchObject({
      avatarUrl: "https://forum.symbaiex.com/images/forum/belle-neko-news.png",
      customTitle: "Canary News Neko",
      postCount: 1,
      threadCount: 1,
    });
  });

  test("returns safe defaults for signed-in users and rejects guests", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    await expect(
      t.query(api.forum.getMyForumNotificationPreferences, {}),
    ).rejects.toThrow(/Sign in/);

    const preferences = await asTrusted.query(
      api.forum.getMyForumNotificationPreferences,
      {},
    );
    expect(preferences).toMatchObject({
      userId: seed.trustedUserId,
      inAppReplies: true,
      inAppNewThreads: true,
      emailReplies: false,
      emailNewThreads: false,
      emailDestinationAvailable: true,
      emailDeliveryEnabled: false,
      emailDestinationLabel: "tr***@example.com",
    });
    expect(preferences._id).toBeUndefined();
  });

  test("updates and persists notification preferences", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    const updated = await asTrusted.mutation(
      api.forum.updateMyForumNotificationPreferences,
      {
        inAppReplies: false,
        inAppNewThreads: true,
        emailReplies: true,
        emailNewThreads: false,
      },
    );
    expect(updated).toMatchObject({
      userId: seed.trustedUserId,
      inAppReplies: false,
      inAppNewThreads: true,
      emailReplies: true,
      emailNewThreads: false,
      emailDestinationAvailable: true,
      emailDeliveryEnabled: false,
    });
    expect(updated._id).toEqual(expect.any(String));

    await expect(
      asTrusted.query(api.forum.getMyForumNotificationPreferences, {}),
    ).resolves.toMatchObject({
      _id: updated._id,
      inAppReplies: false,
      emailReplies: true,
    });
  });

  test("updates classic forum profile fields and exposes public profile metadata", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    const updated = await asTrusted.mutation(api.forum.updateMyForumProfile, {
      avatarUrl: "https://cdn.example.com/avatar.png",
      bio: "Collector of old web systems.",
      birthday: "1990-05-20",
      customTitle: "Archivist",
      location: "Austin, TX",
      signature: "[b]Still posting[/b]",
      showSignatures: false,
      timeZone: "America/Chicago",
      websiteUrl: "https://symbaiex.com/forum-notes",
    });

    expect(updated).toMatchObject({
      userId: seed.trustedUserId,
      avatarUrl: "https://cdn.example.com/avatar.png",
      bio: "Collector of old web systems.",
      birthday: "1990-05-20",
      customTitle: "Archivist",
      location: "Austin, TX",
      signature: "[b]Still posting[/b]",
      showSignatures: false,
      timeZone: "America/Chicago",
      websiteUrl: "https://symbaiex.com/forum-notes",
    });

    await expect(
      asTrusted.query(api.forum.getMyForumProfile, {}),
    ).resolves.toMatchObject({
      avatarUrl: "https://cdn.example.com/avatar.png",
      bio: "Collector of old web systems.",
      location: "Austin, TX",
      websiteUrl: "https://symbaiex.com/forum-notes",
    });

    const publicProfile = await t.query(api.users.publicProfile, {
      username: "trustedauthor",
    });
    if (publicProfile === null) {
      throw new Error("Expected trustedauthor public profile");
    }
    expect(publicProfile).toMatchObject({
      forumProfile: {
        avatarUrl: "https://cdn.example.com/avatar.png",
        bio: "Collector of old web systems.",
        birthday: "1990-05-20",
        customTitle: "Archivist",
        location: "Austin, TX",
        timeZone: "America/Chicago",
        websiteUrl: "https://symbaiex.com/forum-notes",
      },
    });
    expect(publicProfile.forumProfile).not.toHaveProperty("signature");

    const members = await t.query(api.forum.listMembers, {
      query: "Austin",
      pageSize: 10,
    });
    expect(members.members).toContainEqual(
      expect.objectContaining({
        username: "trustedauthor",
        avatarUrl: "https://cdn.example.com/avatar.png",
        customTitle: "Archivist",
        location: "Austin, TX",
      }),
    );
  });

  test("rejects invalid forum profile urls and birthdays", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    await expect(
      asTrusted.mutation(api.forum.updateMyForumProfile, {
        avatarUrl: "javascript:alert(1)",
        showSignatures: true,
      }),
    ).rejects.toThrow(/Avatar URL must use http or https/);

    await expect(
      asTrusted.mutation(api.forum.updateMyForumProfile, {
        birthday: "1990-02-31",
        showSignatures: true,
      }),
    ).rejects.toThrow(/Birthday must be a valid date/);
  });

  test("member directory includes trusted users before they post or save a profile", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const zeroActivityUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Zero Activity",
        username: "zeroactivity",
        usernameNormalized: "zeroactivity",
        forumTrustedAt: 1_800_000_002_000,
        forumTrustedBy: seed.ownerId,
      });
    });

    const profileRows = await t.run(async (ctx) => {
      return await ctx.db
        .query("forumUserProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", zeroActivityUserId))
        .take(1);
    });
    expect(profileRows).toEqual([]);

    const members = await t.query(api.forum.listMembers, {
      query: "zero",
      pageSize: 10,
    });

    expect(members.members).toContainEqual(
      expect.objectContaining({
        _id: zeroActivityUserId,
        username: "zeroactivity",
        displayName: "zeroactivity",
        rank: "New Member",
        threadCount: 0,
        postCount: 0,
        reputationScore: 0,
      }),
    );
  });

  test("member directory and statistics exclude untrusted forum profiles", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asUntrusted = t.withIdentity({
      subject: seed.untrustedUserId,
      name: "New Member",
    });

    await expect(
      asUntrusted.mutation(api.forum.updateMyForumProfile, {
        bio: "Trying to join the public member list early.",
        showSignatures: true,
      }),
    ).rejects.toThrow(/approve your forum access/);

    await t.run(async (ctx) => {
      await ctx.db.insert("forumUserProfiles", {
        userId: seed.untrustedUserId,
        bio: "Seeded profile should still stay private.",
        showSignatures: true,
        threadCount: 99,
        postCount: 99,
        reputationScore: 99,
        createdAt: 1_800_000_003_000,
        updatedAt: 1_800_000_003_000,
      });
    });

    const members = await t.query(api.forum.listMembers, {
      query: "newmember",
      pageSize: 10,
    });
    expect(members.members).toEqual([]);

    const overview = await t.query(api.forum.overview, {});
    expect(overview.statistics).toMatchObject({
      memberCount: 3,
      newestMember: {
        userId: seed.otherTrustedUserId,
        username: "othertrusted",
      },
      topPoster: null,
      reputationLeader: null,
    });
  });

  test("synthetic auth email is not a forum email destination", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asSynthetic = t.withIdentity({
      subject: seed.syntheticEmailUserId,
      name: "Synthetic Email",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await expect(
      asSynthetic.query(api.forum.getMyForumNotificationPreferences, {}),
    ).resolves.toMatchObject({
      emailDestinationAvailable: false,
      emailDeliveryEnabled: false,
    });

    await expect(
      asSynthetic.mutation(api.forum.updateMyForumNotificationPreferences, {
        inAppReplies: false,
        inAppNewThreads: true,
        emailReplies: true,
        emailNewThreads: false,
      }),
    ).resolves.toMatchObject({
      emailDestinationAvailable: false,
      emailReplies: true,
    });

    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.syntheticEmailUserId,
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    const reply = await asOtherTrusted.mutation(api.forum.createReply, {
      threadId: seed.publicThreadId,
      body: "Synthetic auth emails should not receive forum mail.",
    });

    const deliveries = await t.run(async (ctx) => {
      return await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.syntheticEmailUserId)
            .eq("type", "reply"),
        )
        .take(5);
    });
    expect(deliveries).toEqual([]);
  });

  test("reply fanout keeps in-app notifications on by default without email rows", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.trustedUserId,
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    const reply = await asOtherTrusted.mutation(api.forum.createReply, {
      threadId: seed.publicThreadId,
      body: "Default notification behavior should still create an inbox row.",
    });

    const snapshot = await t.run(async (ctx) => {
      const notifications = await ctx.db
        .query("forumNotifications")
        .withIndex("by_postId_and_recipientUserId", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.trustedUserId),
        )
        .take(5);
      const deliveries = await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.trustedUserId)
            .eq("type", "reply"),
        )
        .take(5);
      return { notifications, deliveries };
    });

    expect(snapshot.notifications).toHaveLength(1);
    expect(snapshot.notifications[0]).toMatchObject({
      recipientUserId: seed.trustedUserId,
      actorUserId: seed.otherTrustedUserId,
      type: "reply",
      status: "unread",
    });
    expect(snapshot.deliveries).toEqual([]);
  });

  test("reply fanout respects in-app and email reply preferences", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asUntrusted = t.withIdentity({
      subject: seed.untrustedUserId,
      name: "New Member",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: false,
      inAppNewThreads: true,
      emailReplies: true,
      emailNewThreads: false,
    });
    await asUntrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: false,
      inAppNewThreads: true,
      emailReplies: true,
      emailNewThreads: false,
    });
    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      for (const userId of [seed.trustedUserId, seed.untrustedUserId]) {
        await ctx.db.insert("forumThreadSubscriptions", {
          userId,
          threadId: seed.publicThreadId,
          categoryId: seed.publicCategoryId,
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const reply = await asOtherTrusted.mutation(api.forum.createReply, {
      threadId: seed.publicThreadId,
      body: "Email-ready reply notifications should queue only for email users.",
    });

    const snapshot = await t.run(async (ctx) => {
      const notifications = await ctx.db
        .query("forumNotifications")
        .withIndex("by_postId_and_createdAt", (q) =>
          q.eq("postId", reply.postId),
        )
        .take(10);
      const trustedDeliveries = await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.trustedUserId)
            .eq("type", "reply"),
        )
        .take(5);
      const untrustedDeliveries = await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.untrustedUserId)
            .eq("type", "reply"),
        )
        .take(5);
      return { notifications, trustedDeliveries, untrustedDeliveries };
    });

    expect(snapshot.notifications).toEqual([]);
    expect(snapshot.trustedDeliveries).toHaveLength(1);
    expect(snapshot.trustedDeliveries[0]).toMatchObject({
      recipientUserId: seed.trustedUserId,
      actorUserId: seed.otherTrustedUserId,
      threadId: seed.publicThreadId,
      categoryId: seed.publicCategoryId,
      postId: reply.postId,
      type: "reply",
      status: expect.stringMatching(/^(queued|skipped)$/),
      toEmail: "trusted@example.com",
    });
    expect(snapshot.trustedDeliveries[0].notificationId).toBeUndefined();
    expect(snapshot.untrustedDeliveries).toEqual([]);
  });

  test("queued delivery context rechecks email reply preferences before send", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: false,
      inAppNewThreads: true,
      emailReplies: true,
      emailNewThreads: false,
    });
    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.trustedUserId,
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    const reply = await asOtherTrusted.mutation(api.forum.createReply, {
      threadId: seed.publicThreadId,
      body: "Queued email rows should respect preference changes before send.",
    });
    const deliveryId = await t.run(async (ctx) => {
      const delivery = await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.trustedUserId)
            .eq("type", "reply"),
        )
        .unique();
      if (delivery === null) {
        throw new Error("Expected queued forum email delivery");
      }
      return delivery._id;
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: false,
      inAppNewThreads: true,
      emailReplies: false,
      emailNewThreads: false,
    });

    await expect(
      t.query(internal.forum.readForumNotificationEmailDeliveryContext, {
        deliveryId,
      }),
    ).resolves.toEqual({
      ready: false,
      reason: "Forum email notification preference is disabled",
    });
  });

  test("queued delivery context rechecks recipient board visibility before send", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: false,
      inAppNewThreads: true,
      emailReplies: true,
      emailNewThreads: false,
    });
    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.trustedUserId,
        threadId: seed.trustedThreadId,
        categoryId: seed.trustedCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    const reply = await asOtherTrusted.mutation(api.forum.createReply, {
      threadId: seed.trustedThreadId,
      body: "Trusted board mail should stop if forum trust is revoked first.",
    });
    const deliveryId = await t.run(async (ctx) => {
      const delivery = await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.trustedUserId)
            .eq("type", "reply"),
        )
        .unique();
      if (delivery === null) {
        throw new Error("Expected queued forum email delivery");
      }
      await ctx.db.patch(seed.trustedUserId, {
        forumTrustedAt: undefined,
        forumTrustedBy: undefined,
        forumTrustRevokedAt: 1_800_000_002_000,
        forumTrustRevokedBy: seed.ownerId,
      });
      return delivery._id;
    });

    await expect(
      t.query(internal.forum.readForumNotificationEmailDeliveryContext, {
        deliveryId,
      }),
    ).resolves.toEqual({
      ready: false,
      reason: "Forum email recipient can no longer view this board",
    });
  });

  test("queued delivery context rechecks recipient email destination before send", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: false,
      inAppNewThreads: true,
      emailReplies: true,
      emailNewThreads: false,
    });
    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.trustedUserId,
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    const reply = await asOtherTrusted.mutation(api.forum.createReply, {
      threadId: seed.publicThreadId,
      body: "Queued email rows should stop if the address changes first.",
    });
    const deliveryId = await t.run(async (ctx) => {
      const delivery = await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.trustedUserId)
            .eq("type", "reply"),
        )
        .unique();
      if (delivery === null) {
        throw new Error("Expected queued forum email delivery");
      }
      await ctx.db.patch(seed.trustedUserId, {
        contactEmail: "updated-trusted@example.com",
      });
      return delivery._id;
    });

    await expect(
      t.query(internal.forum.readForumNotificationEmailDeliveryContext, {
        deliveryId,
      }),
    ).resolves.toEqual({
      ready: false,
      reason: "Forum email recipient address changed before delivery",
    });
  });

  test("queued reply delivery context rechecks active thread watch before send", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: false,
      inAppNewThreads: true,
      emailReplies: true,
      emailNewThreads: false,
    });
    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.trustedUserId,
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    const reply = await asOtherTrusted.mutation(api.forum.createReply, {
      threadId: seed.publicThreadId,
      body: "Queued reply email should respect muted thread watches.",
    });
    const deliveryId = await t.run(async (ctx) => {
      const delivery = await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.trustedUserId)
            .eq("type", "reply"),
        )
        .unique();
      if (delivery === null) {
        throw new Error("Expected queued forum email delivery");
      }
      return delivery._id;
    });

    await asTrusted.mutation(api.forum.toggleThreadSubscription, {
      threadId: seed.publicThreadId,
    });

    await expect(
      t.query(internal.forum.readForumNotificationEmailDeliveryContext, {
        deliveryId,
      }),
    ).resolves.toEqual({
      ready: false,
      reason: "Forum email subscription is no longer active",
    });
  });

  test("queued new-thread delivery context rechecks active board watch before send", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: true,
      inAppNewThreads: false,
      emailReplies: false,
      emailNewThreads: true,
    });
    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumCategorySubscriptions", {
        userId: seed.trustedUserId,
        categoryId: seed.publicCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    const thread = await asOtherTrusted.mutation(api.forum.createThread, {
      categorySlug: "public-square",
      title: "Watched board queue",
      body: "Queued board email should respect muted board watches.",
    });
    const deliveryId = await t.run(async (ctx) => {
      const delivery = await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_threadId_and_recipientUserId_and_type", (q) =>
          q
            .eq("threadId", thread.threadId)
            .eq("recipientUserId", seed.trustedUserId)
            .eq("type", "newThread"),
        )
        .unique();
      if (delivery === null) {
        throw new Error("Expected queued forum email delivery");
      }
      return delivery._id;
    });

    await asTrusted.mutation(api.forum.toggleCategorySubscription, {
      categorySlug: "public-square",
    });

    await expect(
      t.query(internal.forum.readForumNotificationEmailDeliveryContext, {
        deliveryId,
      }),
    ).resolves.toEqual({
      ready: false,
      reason: "Forum email subscription is no longer active",
    });
  });

  test("scheduled delivery action safely skips queued rows when disabled", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: false,
      inAppNewThreads: true,
      emailReplies: true,
      emailNewThreads: false,
    });
    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.trustedUserId,
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_002_000);
    try {
      const reply = await asOtherTrusted.mutation(api.forum.createReply, {
        threadId: seed.publicThreadId,
        body: "Scheduled disabled forum email delivery should be skipped.",
      });

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const deliveries = await t.run(async (ctx) => {
        return await ctx.db
          .query("forumNotificationEmailDeliveries")
          .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
            q
              .eq("postId", reply.postId)
              .eq("recipientUserId", seed.trustedUserId)
              .eq("type", "reply"),
          )
          .take(5);
      });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        status: "skipped",
        reason: "Forum email notifications are disabled",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("scheduled delivery action fails queued rows when sender config is missing", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: false,
      inAppNewThreads: true,
      emailReplies: true,
      emailNewThreads: false,
    });
    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.trustedUserId,
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    vi.stubEnv("FORUM_EMAIL_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("FORUM_FROM_EMAIL", "");
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_002_000);
    try {
      const reply = await asOtherTrusted.mutation(api.forum.createReply, {
        threadId: seed.publicThreadId,
        body: "Missing forum email sender configuration should fail clearly.",
      });

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const deliveries = await t.run(async (ctx) => {
        return await ctx.db
          .query("forumNotificationEmailDeliveries")
          .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
            q
              .eq("postId", reply.postId)
              .eq("recipientUserId", seed.trustedUserId)
              .eq("type", "reply"),
          )
          .take(5);
      });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        status: "failed",
        error: "Forum email notifications are not fully configured",
      });
      expect(deliveries[0].failedAt).toBe(1_800_000_002_000);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  test("forum notification email helpers render direct old-web forum links", async () => {
    const context: ForumNotificationEmailRenderContext = {
      actorName: "Other Trusted",
      categoryName: "Public Square",
      categorySlug: "public-square",
      excerpt: "A watched reply with enough context to pull readers back in.",
      postNumber: 21,
      postPage: 2,
      recipientName: "Trusted Author",
      threadSlug: "public-lunar-brief",
      threadTitle: "Public lunar brief",
      toEmail: "trusted@example.com",
      type: "reply",
    };

    expect(
      forumNotificationEmailUrl(context, "https://forum.symbaiex.com/"),
    ).toBe(
      "https://forum.symbaiex.com/public-square/public-lunar-brief?postPage=2#post-21",
    );
    expect(forumNotificationEmailSubject(context)).toBe(
      "[SYMBaiEX forum] New reply: Public lunar brief",
    );

    const email = await buildForumNotificationEmail(
      context,
      "https://forum.symbaiex.com/",
    );

    expect(email.threadUrl).toBe(
      "https://forum.symbaiex.com/public-square/public-lunar-brief?postPage=2#post-21",
    );
    expect(email.text).toContain("Other Trusted");
    expect(email.text).toContain("Public Square");
    expect(email.text).toContain("watch this forum thread");
    expect(email.html).toContain("SYMBaiEX forum");
  });

  test("new-thread fanout respects board notification preferences", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: true,
      inAppNewThreads: false,
      emailReplies: false,
      emailNewThreads: true,
    });
    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumCategorySubscriptions", {
        userId: seed.trustedUserId,
        categoryId: seed.publicCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    const thread = await asOtherTrusted.mutation(api.forum.createThread, {
      categorySlug: "public-square",
      title: "Email-ready board watch",
      body: "A watched board thread should queue email without in-app rows.",
    });

    const snapshot = await t.run(async (ctx) => {
      const notifications = await ctx.db
        .query("forumNotifications")
        .withIndex("by_threadId_and_recipientUserId_and_type", (q) =>
          q
            .eq("threadId", thread.threadId)
            .eq("recipientUserId", seed.trustedUserId)
            .eq("type", "newThread"),
        )
        .take(5);
      const deliveries = await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_threadId_and_recipientUserId_and_type", (q) =>
          q
            .eq("threadId", thread.threadId)
            .eq("recipientUserId", seed.trustedUserId)
            .eq("type", "newThread"),
        )
        .take(5);
      return { deliveries, notifications };
    });

    expect(snapshot.notifications).toEqual([]);
    expect(snapshot.deliveries).toHaveLength(1);
    expect(snapshot.deliveries[0]).toMatchObject({
      recipientUserId: seed.trustedUserId,
      actorUserId: seed.otherTrustedUserId,
      categoryId: seed.publicCategoryId,
      type: "newThread",
      status: expect.stringMatching(/^(queued|skipped)$/),
      toEmail: "trusted@example.com",
    });
    expect(snapshot.deliveries[0].notificationId).toBeUndefined();
  });

  test("muted subscriptions and actor self events do not queue email rows", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateMyForumNotificationPreferences, {
      inAppReplies: true,
      inAppNewThreads: true,
      emailReplies: true,
      emailNewThreads: true,
    });
    await asOtherTrusted.mutation(
      api.forum.updateMyForumNotificationPreferences,
      {
        inAppReplies: true,
        inAppNewThreads: true,
        emailReplies: true,
        emailNewThreads: true,
      },
    );
    await t.run(async (ctx) => {
      const now = 1_800_000_001_000;
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.trustedUserId,
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        status: "muted",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.otherTrustedUserId,
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    const reply = await asOtherTrusted.mutation(api.forum.createReply, {
      threadId: seed.publicThreadId,
      body: "Muted subscriptions and self watches should not queue email rows.",
    });

    const deliveries = await t.run(async (ctx) => {
      return await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.trustedUserId)
            .eq("type", "reply"),
        )
        .take(5);
    });
    const selfDeliveries = await t.run(async (ctx) => {
      return await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
          q
            .eq("postId", reply.postId)
            .eq("recipientUserId", seed.otherTrustedUserId)
            .eq("type", "reply"),
        )
        .take(5);
    });

    expect(deliveries).toEqual([]);
    expect(selfDeliveries).toEqual([]);
  });
});

describe("forum privacy regressions", () => {
  test("stores long threads and replies without truncating their endings", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });
    const threadEnding = "THREAD-END-SENTINEL";
    const replyEnding = "REPLY-END-SENTINEL";
    const threadBody = `${"Long-form forum reporting section. ".repeat(600)}${threadEnding}`;
    const replyBody = `${"Detailed community response section. ".repeat(400)}${replyEnding}`;

    expect(threadBody.length).toBeGreaterThan(12_000);
    expect(threadBody.length).toBeLessThanOrEqual(FORUM_THREAD_BODY_MAX_LENGTH);
    expect(replyBody.length).toBeGreaterThan(6_000);
    expect(replyBody.length).toBeLessThanOrEqual(FORUM_REPLY_BODY_MAX_LENGTH);

    const thread = await asOtherTrusted.mutation(api.forum.createThread, {
      categorySlug: "public-square",
      title: "Long-form reporting survives intact",
      body: threadBody,
    });
    const reply = await asOtherTrusted.mutation(api.forum.createReply, {
      threadId: thread.threadId,
      body: replyBody,
    });
    const stored = await t.run(async (ctx) => ({
      thread: await ctx.db.get(thread.threadId),
      reply: await ctx.db.get(reply.postId),
    }));

    expect(stored.thread?.body).toBe(threadBody);
    expect(stored.thread?.body.endsWith(threadEnding)).toBe(true);
    expect(stored.reply?.body).toBe(replyBody);
    expect(stored.reply?.body.endsWith(replyEnding)).toBe(true);
  });

  test("mode=new shows unread trusted threads for trusted users even when public board is read", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const now = 1_800_000_000_300;

    await t.run(async (ctx) => {
      await ctx.db.insert("forumCategoryReads", {
        userId: seed.trustedUserId,
        categoryId: seed.publicCategoryId,
        lastPostAt: 1_800_000_000_001,
        lastReadAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });

    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const recent = await asTrusted.query(api.forum.listRecentThreads, {
      mode: "new",
      pageSize: 10,
    });
    const slugs = recent.threads.map((thread) => thread.slug);
    expect(slugs).toEqual(["trusted-lunar-brief"]);
  });

  test("mode=today does not expose trusted-only threads to guests", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const now = Date.UTC(2026, 0, 5, 12, 0, 0);
    const todayStart = now - (now % 86_400_000);
    const fakeNow = now;

    await t.run(async (ctx) => {
      await insertThread(ctx, {
        categoryId: seed.publicCategoryId,
        categorySlug: "public-square",
        slug: "public-today-thread",
        title: "Public thread from today",
        body: "Public visible activity from today.",
        authorId: seed.trustedUserId,
        now: todayStart + 1_000,
      });
      await insertThread(ctx, {
        categoryId: seed.trustedCategoryId,
        categorySlug: "trusted-lab",
        slug: "trusted-today-thread",
        title: "Trusted thread from today",
        body: "Trusted-only activity from today.",
        authorId: seed.trustedUserId,
        now: todayStart + 2_000,
      });
    });

    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);
    try {
      const recent = await t.query(api.forum.listRecentThreads, {
        mode: "today",
        pageSize: 10,
      });
      const visibleSlugs = recent.threads.map((thread) => thread.slug);
      expect(visibleSlugs).toContain("public-today-thread");
      expect(visibleSlugs).not.toContain("trusted-today-thread");
    } finally {
      vi.useRealTimers();
    }
  });

  test("board prefix filters apply across the whole board instead of the loaded page", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const prefixId = await t.run(async (ctx) => {
      const now = 1_800_000_010_000;
      const dispatchPrefixId = await ctx.db.insert("forumThreadPrefixes", {
        categoryId: seed.publicCategoryId,
        key: "public-square:dispatch",
        slug: "dispatch",
        label: "Dispatch",
        color: "#ffcc00",
        status: "active",
        position: 10,
        createdAt: now,
        updatedAt: now,
      });
      await insertThread(ctx, {
        categoryId: seed.publicCategoryId,
        categorySlug: "public-square",
        prefix: {
          _id: dispatchPrefixId,
          slug: "dispatch",
          label: "Dispatch",
          color: "#ffcc00",
        },
        slug: "older-prefixed-dispatch",
        title: "Older prefixed dispatch",
        body: "This prefixed thread is older than the first unfiltered page.",
        authorId: seed.trustedUserId,
        now: now + 1,
      });
      await insertThread(ctx, {
        categoryId: seed.publicCategoryId,
        categorySlug: "public-square",
        slug: "newer-unprefixed-note",
        title: "Newer unprefixed note",
        body: "This unprefixed thread should win the unfiltered first page.",
        authorId: seed.trustedUserId,
        now: now + 2,
      });
      await ctx.db.patch(seed.publicCategoryId, {
        threadCount: 3,
        postCount: 4,
        updatedAt: now + 3,
      });
      return dispatchPrefixId;
    });

    const unfiltered = await t.query(api.forum.listThreads, {
      categorySlug: "public-square",
      pageSize: 1,
    });
    expect(unfiltered.threads.map((thread) => thread.slug)).toEqual([
      "newer-unprefixed-note",
    ]);
    expect(unfiltered.activityThreads.map((thread) => thread.slug)).toEqual([
      "newer-unprefixed-note",
      "older-prefixed-dispatch",
      "public-lunar-brief",
    ]);

    const secondPage = await t.query(api.forum.listThreads, {
      categorySlug: "public-square",
      page: 2,
      pageSize: 1,
    });
    expect(secondPage.threads.map((thread) => thread.slug)).toEqual([
      "older-prefixed-dispatch",
    ]);
    expect(secondPage.activityThreads[0]?.slug).toBe("newer-unprefixed-note");

    const prefixed = await t.query(api.forum.listThreads, {
      categorySlug: "public-square",
      prefixId,
      pageSize: 1,
    });
    expect(prefixed.threads.map((thread) => thread.slug)).toEqual([
      "older-prefixed-dispatch",
    ]);
    expect(prefixed.activityThreads.map((thread) => thread.slug)).toEqual([
      "older-prefixed-dispatch",
    ]);
    expect(prefixed.pagination.totalItems).toBe(1);

    const noPrefix = await t.query(api.forum.listThreads, {
      categorySlug: "public-square",
      prefixId: null,
      pageSize: 10,
    });
    expect(noPrefix.threads.map((thread) => thread.slug)).toContain(
      "newer-unprefixed-note",
    );
    expect(noPrefix.threads.map((thread) => thread.slug)).not.toContain(
      "older-prefixed-dispatch",
    );
  });

  test("board pages expose visible child boards as navigation choices", async () => {
    const t = setup();
    const seed = await seedForum(t);

    await t.run(async (ctx) => {
      const now = 1_800_000_020_000;
      const publicChildId = await insertCategory(ctx, {
        slug: "public-guides",
        name: "Guides",
        viewAccess: "public",
        position: 10,
        now,
      });
      const trustedChildId = await insertCategory(ctx, {
        slug: "trusted-downloads",
        name: "Downloads",
        viewAccess: "trusted",
        position: 20,
        now: now + 1,
      });
      await Promise.all([
        ctx.db.patch(publicChildId, {
          parentCategoryId: seed.publicCategoryId,
        }),
        ctx.db.patch(trustedChildId, {
          parentCategoryId: seed.publicCategoryId,
        }),
      ]);
    });

    const guestBoard = await t.query(api.forum.listThreads, {
      categorySlug: "public-square",
    });
    expect(guestBoard.category.children).toEqual([
      expect.objectContaining({
        slug: "public-guides",
        name: "Guides",
      }),
    ]);
    expect(guestBoard.category).toMatchObject({
      threadCount: 2,
      postCount: 4,
    });

    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const trustedBoard = await asTrusted.query(api.forum.listThreads, {
      categorySlug: "public-square",
    });
    expect(
      trustedBoard.category.children?.map((category) => category.slug),
    ).toEqual(["public-guides", "trusted-downloads"]);
    expect(trustedBoard.category).toMatchObject({
      threadCount: 3,
      postCount: 6,
    });

    const guestOverview = await t.query(api.forum.overview, {});
    const publicBoard = guestOverview.sections
      .flatMap((section) => section.boards)
      .find((board) => board.slug === "public-square");
    expect(publicBoard).toMatchObject({
      threadCount: 2,
      postCount: 4,
    });
  });

  test("board display controls sort and date-prune threads", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const seed = await seedForum(t);
      const dayMs = 86_400_000;
      const now = 1_800_000_000_000 + 60 * dayMs;
      vi.setSystemTime(now);
      await t.run(async (ctx) => {
        const freshPopularId = await insertThread(ctx, {
          categoryId: seed.publicCategoryId,
          categorySlug: "public-square",
          slug: "fresh-popular-thread",
          title: "Fresh popular thread",
          body: "Fresh thread with many replies.",
          authorId: seed.trustedUserId,
          now: now - 2 * dayMs,
        });
        await ctx.db.patch(freshPopularId, {
          replyCount: 20,
          viewCount: 5,
          updatedAt: now - 2 * dayMs,
        });
        const freshQuietId = await insertThread(ctx, {
          categoryId: seed.publicCategoryId,
          categorySlug: "public-square",
          slug: "fresh-quiet-thread",
          title: "Fresh quiet thread",
          body: "Fresh thread with fewer replies.",
          authorId: seed.trustedUserId,
          now: now - 10 * dayMs,
        });
        await ctx.db.patch(freshQuietId, {
          replyCount: 5,
          viewCount: 50,
          updatedAt: now - 10 * dayMs,
        });
        const stalePopularId = await insertThread(ctx, {
          categoryId: seed.publicCategoryId,
          categorySlug: "public-square",
          slug: "stale-popular-thread",
          title: "Stale popular thread",
          body: "Older thread with the most replies.",
          authorId: seed.trustedUserId,
          now: now - 45 * dayMs,
        });
        await ctx.db.patch(stalePopularId, {
          replyCount: 90,
          viewCount: 100,
          updatedAt: now - 45 * dayMs,
        });
        await ctx.db.patch(seed.publicCategoryId, {
          threadCount: 4,
          postCount: 5,
          updatedAt: now,
        });
      });

      const result = await t.query(api.forum.listThreads, {
        categorySlug: "public-square",
        sortKey: "replies",
        sortOrder: "desc",
        days: 30,
        pageSize: 10,
      });
      expect(result.threads.map((thread) => thread.slug)).toEqual([
        "fresh-popular-thread",
        "fresh-quiet-thread",
      ]);
      expect(result.activityThreads.map((thread) => thread.slug)).toEqual([
        "fresh-popular-thread",
        "fresh-quiet-thread",
      ]);
      expect(result.pagination.totalItems).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("route preflight hides trusted boards and threads from guests", async () => {
    const t = setup();
    const seed = await seedForum(t);

    await expect(
      t.query(api.forum.routeStatus, { categorySlug: "public-square" }),
    ).resolves.toMatchObject({
      exists: true,
      kind: "category",
      categoryName: "Public Square",
      categoryDescription: "Public Square description",
    });
    await expect(
      t.query(api.forum.routeStatus, { categorySlug: "trusted-lab" }),
    ).resolves.toMatchObject({ exists: false, kind: "missing" });
    await expect(
      t.query(api.forum.routeStatus, {
        categorySlug: "trusted-lab",
        threadSlug: "trusted-lunar-brief",
      }),
    ).resolves.toMatchObject({ exists: false, kind: "missing" });

    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.trustedThreadId, {
        body: "[h2]Trusted launch</h2] Trusted members can read this lunar launch discussion.",
      });
    });
    await expect(
      asTrusted.query(api.forum.routeStatus, {
        categorySlug: "trusted-lab",
        threadSlug: "trusted-lunar-brief",
      }),
    ).resolves.toMatchObject({
      exists: true,
      kind: "thread",
      categoryName: "Trusted Lab",
      threadTitle: "Trusted lunar brief",
      threadExcerpt:
        "Trusted launch Trusted members can read this lunar launch discussion.",
    });
  });

  test("overview hydrates real latest-thread metadata without UI placeholders", async () => {
    const t = setup();
    const seed = await seedForum(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.publicCategoryId, {
        lastThreadId: seed.publicThreadId,
        lastPostAt: 1_800_000_000_001,
      });
    });

    const [categories, overview] = await Promise.all([
      t.query(api.forum.listCategories, {}),
      t.query(api.forum.overview, {}),
    ]);
    expect(
      categories.find((category) => category.slug === "public-square")
        ?.lastThread,
    ).toMatchObject({
      author: "trustedauthor",
      lastPostAuthor: "trustedauthor",
      lastPostAt: 1_800_000_000_001,
    });
    expect(
      overview.newestThreads.find(
        (thread) => thread.slug === "public-lunar-brief",
      ),
    ).toMatchObject({ categoryName: "Public Square" });
  });

  test("search filters protected boards for keyword and author searches", async () => {
    const t = setup();
    const seed = await seedForum(t);

    const guestKeyword = await t.query(api.forum.search, {
      query: "lunar",
      pageSize: 10,
    });
    expect(guestKeyword.threads.map((thread) => thread.categorySlug)).toEqual([
      "public-square",
    ]);
    expect(guestKeyword.posts.map((post) => post.categorySlug)).toEqual([
      "public-square",
    ]);

    const guestAuthor = await t.query(api.forum.search, {
      author: "trustedauthor",
      resultType: "threads",
      pageSize: 10,
    });
    expect(guestAuthor.threads.map((thread) => thread.categorySlug)).toEqual([
      "public-square",
    ]);

    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const trustedKeyword = await asTrusted.query(api.forum.search, {
      query: "lunar",
      pageSize: 10,
    });
    expect(
      trustedKeyword.threads.map((thread) => thread.categorySlug).sort(),
    ).toEqual(["public-square", "trusted-lab"]);
    expect(
      trustedKeyword.posts.map((post) => post.categorySlug).sort(),
    ).toEqual(["public-square", "trusted-lab"]);
  });

  test("advanced forum search filters target, date window, and sort order", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const seed = await seedForum(t);
      const dayMs = 86_400_000;
      const now = 1_800_000_000_000 + 90 * dayMs;
      vi.setSystemTime(now);
      await t.run(async (ctx) => {
        const titleThreadId = await insertThread(ctx, {
          categoryId: seed.publicCategoryId,
          categorySlug: "public-square",
          slug: "needle-title-thread",
          title: "Needle title thread",
          body: "This body deliberately avoids the marker.",
          authorId: seed.trustedUserId,
          now: now - 2 * dayMs,
        });
        await ctx.db.patch(titleThreadId, {
          replyCount: 4,
          viewCount: 20,
        });
        const bodyLowThreadId = await insertThread(ctx, {
          categoryId: seed.publicCategoryId,
          categorySlug: "public-square",
          slug: "needle-body-low-thread",
          title: "Low reply body match",
          body: "Needle appears in this body only.",
          authorId: seed.trustedUserId,
          now: now - 3 * dayMs,
        });
        await ctx.db.patch(bodyLowThreadId, {
          replyCount: 2,
          viewCount: 15,
        });
        const bodyHighThreadId = await insertThread(ctx, {
          categoryId: seed.publicCategoryId,
          categorySlug: "public-square",
          slug: "needle-body-high-thread",
          title: "High reply body match",
          body: "Needle appears in this busier body only.",
          authorId: seed.trustedUserId,
          now: now - 4 * dayMs,
        });
        await ctx.db.patch(bodyHighThreadId, {
          replyCount: 30,
          viewCount: 80,
        });
        const staleThreadId = await insertThread(ctx, {
          categoryId: seed.publicCategoryId,
          categorySlug: "public-square",
          slug: "needle-stale-thread",
          title: "Needle stale thread",
          body: "Needle appears here too, but outside the window.",
          authorId: seed.trustedUserId,
          now: now - 60 * dayMs,
        });
        await ctx.db.patch(staleThreadId, {
          replyCount: 99,
          viewCount: 200,
        });
        await ctx.db.patch(seed.publicCategoryId, {
          threadCount: 5,
          postCount: 6,
          updatedAt: now,
        });
      });

      const titleOnly = await t.query(api.forum.search, {
        query: "needle",
        target: "titles",
        days: 30,
        pageSize: 10,
      });
      expect(titleOnly.threads.map((thread) => thread.slug)).toEqual([
        "needle-title-thread",
      ]);
      expect(titleOnly.posts).toEqual([]);
      expect(titleOnly.filters).toMatchObject({
        target: "titles",
        days: 30,
      });

      const bodiesByReplies = await t.query(api.forum.search, {
        query: "needle",
        target: "bodies",
        sortKey: "replies",
        days: 30,
        resultType: "threads",
        pageSize: 10,
      });
      expect(bodiesByReplies.threads.map((thread) => thread.slug)).toEqual([
        "needle-body-high-thread",
        "needle-body-low-thread",
      ]);
      expect(
        bodiesByReplies.threads.map((thread) => thread.replyCount),
      ).toEqual([30, 2]);
      expect(
        bodiesByReplies.threads.map((thread) => thread.slug),
      ).not.toContain("needle-stale-thread");
    } finally {
      vi.useRealTimers();
    }
  });

  test("public announcement queries only return active visible announcements", async () => {
    const t = setup();
    const seed = await seedForum(t);
    await t.run(async (ctx) => {
      const now = 1_800_000_000_050;
      for (const announcement of [
        {
          categoryId: undefined,
          slug: "active-global",
          title: "Active global",
          status: "active" as const,
          position: 10,
        },
        {
          categoryId: undefined,
          slug: "archived-global",
          title: "Archived global",
          status: "archived" as const,
          position: 20,
        },
        {
          categoryId: seed.publicCategoryId,
          slug: "active-public",
          title: "Active public",
          status: "active" as const,
          position: 30,
        },
        {
          categoryId: seed.publicCategoryId,
          slug: "archived-public",
          title: "Archived public",
          status: "archived" as const,
          position: 40,
        },
        {
          categoryId: seed.trustedCategoryId,
          slug: "active-trusted",
          title: "Active trusted",
          status: "active" as const,
          position: 50,
        },
      ]) {
        await ctx.db.insert("forumAnnouncements", {
          categoryId: announcement.categoryId,
          key: `${announcement.categoryId ?? "global"}:${announcement.slug}`,
          slug: announcement.slug,
          title: announcement.title,
          body: `${announcement.title} body`,
          status: announcement.status,
          position: announcement.position,
          createdBy: seed.ownerId,
          updatedBy: seed.ownerId,
          createdAt: now + announcement.position,
          updatedAt: now + announcement.position,
        });
      }
    });

    const guestAnnouncements = await t.query(api.forum.listAnnouncements, {
      includeBoardAnnouncements: true,
    });
    expect(
      guestAnnouncements.map((announcement) => announcement.title),
    ).toEqual(["Active global", "Active public"]);
    await expect(
      t.query(api.forum.getAnnouncement, { slug: "active-global" }),
    ).resolves.toMatchObject({ title: "Active global" });
    await expect(
      t.query(api.forum.getAnnouncement, { slug: "archived-global" }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.forum.getAnnouncement, {
        slug: "archived-public",
        categorySlug: "public-square",
      }),
    ).resolves.toBeNull();

    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const trustedAnnouncements = await asTrusted.query(
      api.forum.listAnnouncements,
      { includeBoardAnnouncements: true },
    );
    expect(
      trustedAnnouncements.map((announcement) => announcement.title),
    ).toEqual(["Active global", "Active public", "Active trusted"]);
  });

  test("public help document queries only return active documents in forum order", async () => {
    const t = setup();
    const seed = await seedForum(t);
    await t.run(async (ctx) => {
      const now = 1_800_000_000_075;
      for (const document of [
        {
          slug: "archived-help",
          title: "Archived help",
          status: "archived" as const,
          position: 0,
        },
        {
          slug: "beta-help",
          title: "Beta help",
          status: "active" as const,
          position: 10,
        },
        {
          slug: "alpha-help",
          title: "Alpha help",
          body:
            "[b]Alpha help[/b] body\n\n" +
            "[url=https://example.com]Read more[/url] " +
            "[img]https://example.com/a.png[/img]",
          status: "active" as const,
          position: 10,
        },
        {
          slug: "zed-help",
          title: "Zed help",
          status: "active" as const,
          position: 20,
        },
      ]) {
        await ctx.db.insert("forumHelpDocuments", {
          slug: document.slug,
          title: document.title,
          body: document.body ?? `${document.title} body`,
          status: document.status,
          position: document.position,
          createdBy: seed.ownerId,
          updatedBy: seed.ownerId,
          createdAt: now + document.position,
          updatedAt: now + document.position,
        });
      }
    });

    const documents = await t.query(api.forum.listHelpDocuments, {});
    expect(documents.map((document) => document.title)).toEqual([
      "Alpha help",
      "Beta help",
      "Zed help",
    ]);
    expect(documents[0]).toMatchObject({
      title: "Alpha help",
      excerpt: "Alpha help body Read more",
    });
    expect(documents[0]).not.toHaveProperty("body");
    await expect(
      t.query(api.forum.getHelpDocument, { slug: "alpha-help" }),
    ).resolves.toMatchObject({
      title: "Alpha help",
      body: expect.stringContaining("[b]Alpha help[/b]"),
    });
    await expect(
      t.query(api.forum.getHelpDocument, { slug: "archived-help" }),
    ).resolves.toBeNull();
  });

  test("admin help document mutations require moderators, reject slug conflicts, and log changes", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    await expect(
      t.query(api.forum.listHelpDocumentsAdmin, { includeArchived: true }),
    ).rejects.toThrow(/Sign in/);
    await expect(
      asTrusted.query(api.forum.listHelpDocumentsAdmin, {
        includeArchived: true,
      }),
    ).rejects.toThrow(/admin access/i);
    await expect(
      asTrusted.mutation(api.forum.upsertHelpDocumentAdmin, {
        slug: "posting-guide",
        title: "Posting guide",
        body: "Use the right board before opening a thread.",
        status: "active",
        position: 10,
      }),
    ).rejects.toThrow(/admin access/i);

    const created = await asOwner.mutation(api.forum.upsertHelpDocumentAdmin, {
      slug: "posting-guide",
      title: "Posting guide",
      body: "Use the right board before opening a thread.",
      status: "active",
      position: 10,
    });
    await expect(
      asOwner.mutation(api.forum.upsertHelpDocumentAdmin, {
        slug: "posting-guide",
        title: "Duplicate posting guide",
        body: "This slug should not be accepted.",
        status: "active",
        position: 20,
      }),
    ).rejects.toThrow(/already used/);

    const updated = await asOwner.mutation(api.forum.upsertHelpDocumentAdmin, {
      helpDocumentId: created._id,
      slug: "posting-guide",
      title: "Posting guide updated",
      body: "Use the right board and search before opening a thread.",
      status: "active",
      position: 5,
    });

    expect(updated).toMatchObject({
      _id: created._id,
      title: "Posting guide updated",
      position: 5,
      updatedByName: "owner",
    });
    await expect(
      asOwner.query(api.forum.listHelpDocumentsAdmin, {
        includeArchived: true,
      }),
    ).resolves.toMatchObject([
      {
        _id: created._id,
        title: "Posting guide updated",
        body: "Use the right board and search before opening a thread.",
      },
    ]);

    const events = await t.run(async (ctx) => {
      return await ctx.db
        .query("forumModerationEvents")
        .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
          q.eq("entityType", "forumHelpDocument").eq("entityId", created._id),
        )
        .take(10);
    });
    expect(events.map((event) => event.eventType)).toEqual([
      "forum_help_document_created",
      "forum_help_document_updated",
    ]);
    expect(events.map((event) => event.actorUserId)).toEqual([
      seed.ownerId,
      seed.ownerId,
    ]);
  });

  test("public calendar list is active-only, month-scoped, ordered, and bodyless", async () => {
    const t = setup();
    const seed = await seedForum(t);
    await t.run(async (ctx) => {
      const now = 1_800_000_000_120;
      for (const event of [
        {
          slug: "archived-may-event",
          title: "Archived May event",
          body: "Archived May event body",
          status: "archived" as const,
          startsAt: Date.UTC(2026, 4, 6, 16, 0, 0),
        },
        {
          slug: "later-may-event",
          title: "Later May event",
          body: "Later May event body",
          status: "active" as const,
          startsAt: Date.UTC(2026, 4, 10, 18, 0, 0),
        },
        {
          slug: "alpha-may-event",
          title: "Alpha May event",
          body:
            "[b]Alpha May event[/b] body\n\n" +
            "[url=https://example.com]Read more[/url] " +
            "[img]https://example.com/a.png[/img]",
          status: "active" as const,
          startsAt: Date.UTC(2026, 4, 5, 15, 0, 0),
        },
        {
          slug: "beta-may-event",
          title: "Beta May event",
          body: "Beta May event body",
          status: "active" as const,
          startsAt: Date.UTC(2026, 4, 5, 15, 0, 0),
        },
        {
          slug: "june-event",
          title: "June event",
          body: "June event body",
          status: "active" as const,
          startsAt: Date.UTC(2026, 5, 1, 15, 0, 0),
        },
      ]) {
        const isoDay = new Date(event.startsAt).toISOString().slice(0, 10);
        await ctx.db.insert("forumCalendarEvents", {
          slug: event.slug,
          title: event.title,
          body: event.body,
          status: event.status,
          startsAt: event.startsAt,
          allDay: false,
          month: isoDay.slice(0, 7),
          day: isoDay,
          createdBy: seed.ownerId,
          updatedBy: seed.ownerId,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const events = await t.query(api.forum.listCalendarEvents, {
      month: "2026-05",
    });
    expect(events.map((event) => event.title)).toEqual([
      "Alpha May event",
      "Beta May event",
      "Later May event",
    ]);
    expect(events[0]).toMatchObject({
      slug: "alpha-may-event",
      excerpt: "Alpha May event body Read more",
      month: "2026-05",
      day: "2026-05-05",
    });
    expect(events[0]).not.toHaveProperty("body");
    await expect(
      t.query(api.forum.listCalendarEvents, { month: "1969-12" }),
    ).rejects.toThrow(/valid YYYY-MM/);
  });

  test("public calendar detail returns full active events and hides archived or missing events", async () => {
    const t = setup();
    const seed = await seedForum(t);
    await t.run(async (ctx) => {
      const now = 1_800_000_000_140;
      const startsAt = Date.UTC(2026, 4, 7, 17, 30, 0);
      for (const event of [
        {
          slug: "active-calendar-event",
          title: "Active calendar event",
          body: "[b]Full active event[/b] body",
          status: "active" as const,
        },
        {
          slug: "archived-calendar-event",
          title: "Archived calendar event",
          body: "Archived event body",
          status: "archived" as const,
        },
      ]) {
        const isoDay = new Date(startsAt).toISOString().slice(0, 10);
        await ctx.db.insert("forumCalendarEvents", {
          slug: event.slug,
          title: event.title,
          body: event.body,
          status: event.status,
          startsAt,
          endsAt: startsAt + 60 * 60 * 1_000,
          allDay: false,
          month: isoDay.slice(0, 7),
          day: isoDay,
          createdBy: seed.ownerId,
          updatedBy: seed.ownerId,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    await expect(
      t.query(api.forum.getCalendarEvent, {
        slug: "active-calendar-event",
      }),
    ).resolves.toMatchObject({
      title: "Active calendar event",
      body: expect.stringContaining("[b]Full active event[/b]"),
      month: "2026-05",
      day: "2026-05-07",
    });
    await expect(
      t.query(api.forum.getCalendarEvent, {
        slug: "archived-calendar-event",
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.forum.getCalendarEvent, { slug: "missing-event" }),
    ).resolves.toBeNull();
  });

  test("admin calendar upsert buckets late-night events in the forum timezone", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });
    const lateChicagoEvent = Date.UTC(2026, 5, 1, 4, 30, 0);

    const created = await asOwner.mutation(api.forum.upsertCalendarEventAdmin, {
      slug: "late-may-night",
      title: "Late May night",
      body: "This event should stay on the May calendar.",
      status: "active",
      startsAt: lateChicagoEvent,
      allDay: false,
    });

    expect(created).toMatchObject({
      month: "2026-05",
      day: "2026-05-31",
    });
    await expect(
      t.query(api.forum.listCalendarEvents, { month: "2026-05" }),
    ).resolves.toMatchObject([
      {
        _id: created._id,
        title: "Late May night",
        day: "2026-05-31",
      },
    ]);
    await expect(
      t.query(api.forum.listCalendarEvents, { month: "2026-06" }),
    ).resolves.toEqual([]);
  });

  test("admin calendar list and upsert require moderators, validate conflicts and times, and log changes", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const startsAt = Date.UTC(2026, 4, 8, 19, 0, 0);

    await expect(
      t.query(api.forum.listCalendarEventsAdmin, { includeArchived: true }),
    ).rejects.toThrow(/Sign in/);
    await expect(
      asTrusted.query(api.forum.listCalendarEventsAdmin, {
        includeArchived: true,
      }),
    ).rejects.toThrow(/admin access/i);
    await expect(
      asTrusted.mutation(api.forum.upsertCalendarEventAdmin, {
        slug: "launch-night",
        title: "Launch night",
        body: "Forum launch watch party.",
        status: "active",
        startsAt,
      }),
    ).rejects.toThrow(/admin access/i);

    const created = await asOwner.mutation(api.forum.upsertCalendarEventAdmin, {
      slug: "launch-night",
      title: "Launch night",
      body: "Forum launch watch party.",
      status: "active",
      startsAt,
      endsAt: startsAt + 2 * 60 * 60 * 1_000,
      allDay: false,
    });
    expect(created).toMatchObject({
      slug: "launch-night",
      month: "2026-05",
      day: "2026-05-08",
      body: "Forum launch watch party.",
      createdByName: "owner",
    });

    await expect(
      asOwner.mutation(api.forum.upsertCalendarEventAdmin, {
        slug: "launch-night",
        title: "Duplicate launch night",
        body: "This slug should not be accepted.",
        status: "active",
        startsAt: startsAt + 1_000,
      }),
    ).rejects.toThrow(/already used/);
    await expect(
      asOwner.mutation(api.forum.upsertCalendarEventAdmin, {
        slug: "bad-clock",
        title: "Bad clock",
        body: "Ends before it starts.",
        status: "active",
        startsAt,
        endsAt: startsAt - 1,
      }),
    ).rejects.toThrow(/before event start/);

    const updated = await asOwner.mutation(api.forum.upsertCalendarEventAdmin, {
      eventId: created._id,
      slug: "launch-night",
      title: "Launch night updated",
      body: "Forum launch watch party with a live thread.",
      status: "archived",
      startsAt: startsAt + 86_400_000,
      allDay: true,
    });
    expect(updated).toMatchObject({
      _id: created._id,
      title: "Launch night updated",
      status: "archived",
      allDay: true,
      month: "2026-05",
      day: "2026-05-09",
      updatedByName: "owner",
    });

    await expect(
      asOwner.query(api.forum.listCalendarEventsAdmin, {
        includeArchived: false,
        month: "2026-05",
      }),
    ).resolves.toEqual([]);
    await expect(
      asOwner.query(api.forum.listCalendarEventsAdmin, {
        includeArchived: true,
        month: "2026-05",
      }),
    ).resolves.toMatchObject([
      {
        _id: created._id,
        title: "Launch night updated",
        body: "Forum launch watch party with a live thread.",
      },
    ]);

    const events = await t.run(async (ctx) => {
      return await ctx.db
        .query("forumModerationEvents")
        .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
          q.eq("entityType", "forumCalendarEvent").eq("entityId", created._id),
        )
        .take(10);
    });
    expect(events.map((event) => event.eventType)).toEqual([
      "forum_calendar_event_created",
      "forum_calendar_event_updated",
    ]);
    expect(events.map((event) => event.actorUserId)).toEqual([
      seed.ownerId,
      seed.ownerId,
    ]);
  });

  test("forum categories cannot use reserved static route slugs", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });

    for (const slug of ["help", "calendar"]) {
      await expect(
        asOwner.mutation(api.forum.upsertForumCategory, {
          slug,
          name: slug === "help" ? "Help" : "Calendar",
          description: `This board would shadow the ${slug} route.`,
          kind: "board",
          status: "active",
          viewAccess: "public",
          threadAccess: "trusted",
          replyAccess: "trusted",
          pollAccess: "trusted",
          position: 99,
        }),
      ).rejects.toThrow(/reserved forum route/);
    }
  });

  test("content reports cannot be shaped as private-message reports", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    await expect(
      asTrusted.mutation(api.forum.createReport, {
        entityType: "thread",
        threadId: seed.publicThreadId,
        reason: "Needs moderator review",
      }),
    ).resolves.toMatchObject({ created: true });

    await expect(
      asTrusted.mutation(api.forum.createReport, {
        entityType: "privateMessage" as never,
        threadId: seed.publicThreadId,
        reason: "Wrong report channel",
      }),
    ).rejects.toThrow();
  });

  test("stored forum attachment claims require trusted forum access", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asUntrusted = t.withIdentity({
      subject: seed.untrustedUserId,
      name: "New Member",
    });
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    await expect(
      asUntrusted.query(internal.forum.authorizeForumAttachmentUpload, {}),
    ).rejects.toThrow(/approve your forum access/);
    await expect(
      asTrusted.query(internal.forum.authorizeForumAttachmentUpload, {}),
    ).resolves.toEqual({ ok: true });

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["trusted attachment"], { type: "text/plain" }),
      );
    });
    const claimed = await asTrusted.mutation(
      internal.forum.claimStoredForumAttachmentUpload,
      {
        storageId,
        filename: "../trusted attachment.txt",
        contentType: "text/plain",
      },
    );
    expect(claimed).toMatchObject({
      storageId,
      filename: "..-trusted attachment.txt",
      contentType: "text/plain",
      size: "trusted attachment".length,
    });
    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("forumPendingUploads")
          .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
          .unique(),
      ),
    ).resolves.toMatchObject({
      userId: seed.trustedUserId,
      storageId,
      status: "pending",
      expiresAt: expect.any(Number),
    });
  });

  test("forum attachment HTTP upload route validates requests and creates pending uploads", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asUntrusted = t.withIdentity({
      subject: seed.untrustedUserId,
      name: "New Member",
    });
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    const preflight = await t.fetch("/forum-attachment-upload", {
      method: "OPTIONS",
      headers: {
        Origin: "https://symbaiex.com",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://symbaiex.com",
    );
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );

    const guest = await t.fetch("/forum-attachment-upload", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Forum-Attachment-Filename": encodeURIComponent("guest.txt"),
      },
      body: "guest upload",
    });
    await expect(guest.json()).resolves.toMatchObject({
      error: "Sign in to upload forum attachments.",
    });
    expect(guest.status).toBe(401);

    const untrusted = await asUntrusted.fetch("/forum-attachment-upload", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Forum-Attachment-Filename": encodeURIComponent("new-member.txt"),
      },
      body: "untrusted upload",
    });
    const untrustedPayload = await untrusted.json();
    expect(untrusted.status).toBe(400);
    expect(untrustedPayload.error).toMatch(/approve your forum access/i);

    const unsupportedType = await asTrusted.fetch("/forum-attachment-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Forum-Attachment-Filename": encodeURIComponent("binary.bin"),
      },
      body: "unsupported upload",
    });
    await expect(unsupportedType.json()).resolves.toMatchObject({
      error: "That attachment type is not allowed.",
    });
    expect(unsupportedType.status).toBe(415);

    const empty = await asTrusted.fetch("/forum-attachment-upload", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Forum-Attachment-Filename": encodeURIComponent("empty.txt"),
      },
      body: "",
    });
    await expect(empty.json()).resolves.toMatchObject({
      error: "Attachment file is empty.",
    });
    expect(empty.status).toBe(400);

    const uploaded = await asTrusted.fetch("/forum-attachment-upload", {
      method: "POST",
      headers: {
        "Content-Type": "text/markdown",
        "X-Forum-Attachment-Filename": encodeURIComponent("../notes.md"),
      },
      body: "trusted upload",
    });
    const payload = await uploaded.json();
    expect(uploaded.status).toBe(200);
    expect(payload).toMatchObject({
      filename: "..-notes.md",
      contentType: "text/markdown",
      size: "trusted upload".length,
    });
    expect(typeof payload.storageId).toBe("string");

    const pendingUpload = await t.run(async (ctx) => {
      return await ctx.db
        .query("forumPendingUploads")
        .withIndex("by_storageId", (q) =>
          q.eq("storageId", payload.storageId as Id<"_storage">),
        )
        .unique();
    });
    expect(pendingUpload).toMatchObject({
      userId: seed.trustedUserId,
      filename: "..-notes.md",
      contentType: "text/markdown",
      size: "trusted upload".length,
      status: "pending",
      expiresAt: expect.any(Number),
    });
  });

  test("forum attachment uploads are capped per user before storage writes", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    await t.run(async (ctx) => {
      for (let index = 0; index < 20; index += 1) {
        const storageId = await ctx.storage.store(
          new Blob([`pending upload ${index}`], { type: "text/plain" }),
        );
        await ctx.db.insert("forumPendingUploads", {
          userId: seed.trustedUserId,
          storageId,
          filename: `pending-${index}.txt`,
          contentType: "text/plain",
          size: `pending upload ${index}`.length,
          status: "pending",
          createdAt: 1_800_000_000_000 + index,
          updatedAt: 1_800_000_000_000 + index,
          expiresAt: Date.now() + 60_000,
        });
      }
    });

    await expect(
      asTrusted.query(internal.forum.authorizeForumAttachmentUpload, {}),
    ).rejects.toThrow(/pending uploads are allowed/i);
  });

  test("forum attachment cleanup purges expired pending uploads and deleted attachment storage", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const cleanupNow = 1_800_100_000_000;
    const ids = await t.run(async (ctx) => {
      const expiredStorageId = await ctx.storage.store(
        new Blob(["expired upload"], { type: "text/plain" }),
      );
      const deletedStorageId = await ctx.storage.store(
        new Blob(["deleted attachment"], { type: "text/plain" }),
      );
      const activeStorageId = await ctx.storage.store(
        new Blob(["active attachment"], { type: "text/plain" }),
      );
      const expiredPendingUploadId = await ctx.db.insert(
        "forumPendingUploads",
        {
          userId: seed.trustedUserId,
          storageId: expiredStorageId,
          filename: "expired.txt",
          contentType: "text/plain",
          size: "expired upload".length,
          status: "pending",
          createdAt: cleanupNow - 120_000,
          updatedAt: cleanupNow - 120_000,
          expiresAt: cleanupNow - 60_000,
        },
      );
      const deletedAttachmentId = await ctx.db.insert("forumAttachments", {
        threadId: seed.publicThreadId,
        postId: seed.publicPostId,
        categoryId: seed.publicCategoryId,
        authorId: seed.trustedUserId,
        storageId: deletedStorageId,
        filename: "deleted.txt",
        contentType: "text/plain",
        size: "deleted attachment".length,
        status: "deleted",
        createdAt: cleanupNow - 3 * 86_400_000,
        updatedAt: cleanupNow - 3 * 86_400_000,
        deletedAt: cleanupNow - 2 * 86_400_000,
        deletedBy: seed.trustedUserId,
      });
      const activeAttachmentId = await ctx.db.insert("forumAttachments", {
        threadId: seed.publicThreadId,
        postId: seed.publicPostId,
        categoryId: seed.publicCategoryId,
        authorId: seed.trustedUserId,
        storageId: activeStorageId,
        filename: "active.txt",
        contentType: "text/plain",
        size: "active attachment".length,
        status: "active",
        createdAt: cleanupNow - 120_000,
        updatedAt: cleanupNow - 120_000,
      });
      return {
        activeAttachmentId,
        activeStorageId,
        deletedAttachmentId,
        deletedStorageId,
        expiredPendingUploadId,
        expiredStorageId,
      };
    });

    await expect(
      t.mutation(internal.forum.cleanupForumAttachmentStorage, {
        now: cleanupNow,
        limit: 10,
      }),
    ).resolves.toEqual({
      expiredPendingUploadsDeleted: 1,
      deletedAttachmentsPurged: 1,
    });

    const after = await t.run(async (ctx) => {
      return {
        activeAttachment: await ctx.db.get(ids.activeAttachmentId),
        activeStorage: await ctx.db.system.get("_storage", ids.activeStorageId),
        deletedAttachment: await ctx.db.get(ids.deletedAttachmentId),
        deletedStorage: await ctx.db.system.get(
          "_storage",
          ids.deletedStorageId,
        ),
        expiredPendingUpload: await ctx.db.get(ids.expiredPendingUploadId),
        expiredStorage: await ctx.db.system.get(
          "_storage",
          ids.expiredStorageId,
        ),
      };
    });
    expect(after.expiredPendingUpload).toBeNull();
    expect(after.expiredStorage).toBeNull();
    expect(after.deletedAttachment).toBeNull();
    expect(after.deletedStorage).toBeNull();
    expect(after.activeAttachment).toMatchObject({ status: "active" });
    expect(after.activeStorage).toMatchObject({
      size: "active attachment".length,
    });
  });

  test("claimed forum attachment uploads expire before posting", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const storageId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob(["expired attachment"], { type: "text/plain" }),
      );
      const now = 1_800_000_000_250;
      await ctx.db.insert("forumPendingUploads", {
        userId: seed.trustedUserId,
        storageId,
        filename: "expired.txt",
        contentType: "text/plain",
        size: "expired attachment".length,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        expiresAt: Date.now() - 1_000,
      });
      return storageId;
    });

    await expect(
      asTrusted.mutation(api.forum.createThread, {
        categorySlug: "public-square",
        title: "Expired manifest upload",
        body: "This should fail because the pending upload expired.",
        attachments: [{ storageId, filename: "expired.txt" }],
      }),
    ).rejects.toThrow(/attachment upload is not available/i);

    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("forumPendingUploads")
          .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
          .take(1),
      ),
    ).resolves.toMatchObject([{ status: "pending" }]);
  });

  test("forum attachments must be claimed by the posting member and cannot be replayed", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["launch manifest"]));
    });

    await expect(
      asOtherTrusted.mutation(api.forum.createThread, {
        categorySlug: "public-square",
        title: "Unclaimed manifest upload",
        body: "This attempt should fail because the upload was never claimed.",
        attachments: [{ storageId, filename: "manifest.txt" }],
      }),
    ).rejects.toThrow(/attachment upload is not available/i);

    const pendingUploadId = await t.run(async (ctx) => {
      const now = 1_800_000_000_250;
      return await ctx.db.insert("forumPendingUploads", {
        userId: seed.otherTrustedUserId,
        storageId,
        filename: "..-manifest.txt",
        contentType: "text/plain",
        size: "launch manifest".length,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      asTrusted.mutation(api.forum.createThread, {
        categorySlug: "public-square",
        title: "Borrowed manifest upload",
        body: "Another member should not attach a pending upload they do not own.",
        attachments: [{ storageId, filename: "..-manifest.txt" }],
      }),
    ).rejects.toThrow(/attachment upload is not available/i);

    await expect(
      t.run(async (ctx) => await ctx.db.get(pendingUploadId)),
    ).resolves.toMatchObject({
      status: "pending",
    });

    const thread = await asOtherTrusted.mutation(api.forum.createThread, {
      categorySlug: "public-square",
      title: "Claimed manifest upload",
      body: "This claimed upload should attach to the new forum thread.",
      attachments: [{ storageId, filename: "..-manifest.txt" }],
    });
    expect(thread).toMatchObject({ status: "active" });

    await expect(
      asOtherTrusted.mutation(api.forum.createThread, {
        categorySlug: "public-square",
        title: "Replay manifest upload",
        body: "A consumed upload should not attach to a second thread.",
        attachments: [{ storageId, filename: "..-manifest.txt" }],
      }),
    ).rejects.toThrow(/attachment upload is not available/i);

    const pendingUpload = await t.run(
      async (ctx) => await ctx.db.get(pendingUploadId),
    );
    expect(pendingUpload).toMatchObject({
      userId: seed.otherTrustedUserId,
      status: "consumed",
      consumedAt: expect.any(Number),
    });
  });

  test("thread and reply edits can keep and remove existing attachments", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const attachmentIds = await t.run(async (ctx) => {
      const rootKeep = await insertStoredForumAttachment(ctx, {
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        authorId: seed.trustedUserId,
        filename: "root-keep.txt",
        body: "keep the starter note",
        now: 1_800_000_000_200,
      });
      const rootRemove = await insertStoredForumAttachment(ctx, {
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        authorId: seed.trustedUserId,
        filename: "root-remove.txt",
        body: "remove the stale starter note",
        now: 1_800_000_000_201,
      });
      const replyKeep = await insertStoredForumAttachment(ctx, {
        threadId: seed.publicThreadId,
        postId: seed.publicPostId,
        categoryId: seed.publicCategoryId,
        authorId: seed.trustedUserId,
        filename: "reply-keep.txt",
        body: "keep the reply note",
        now: 1_800_000_000_202,
      });
      const replyRemove = await insertStoredForumAttachment(ctx, {
        threadId: seed.publicThreadId,
        postId: seed.publicPostId,
        categoryId: seed.publicCategoryId,
        authorId: seed.trustedUserId,
        filename: "reply-remove.txt",
        body: "remove the stale reply note",
        now: 1_800_000_000_203,
      });
      return { rootKeep, rootRemove, replyKeep, replyRemove };
    });
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    await expect(
      asTrusted.mutation(api.forum.updatePostContent, {
        postId: seed.publicPostId,
        body: "Public reply about lunar launch logs.",
        attachmentIdsToKeep: [attachmentIds.rootKeep],
        attachments: [],
      }),
    ).rejects.toThrow(/not attached to this post/);

    const threadEdit = await asTrusted.mutation(api.forum.updateThreadContent, {
      threadId: seed.publicThreadId,
      title: "Public lunar brief",
      body: "Public members can read this lunar launch discussion.",
      attachmentIdsToKeep: [attachmentIds.rootKeep],
      attachments: [],
      editReason: "Prune stale starter file",
    });
    expect(threadEdit.updated).toBe(true);
    expect(
      threadEdit.thread.attachments.map((attachment) => attachment._id),
    ).toEqual([attachmentIds.rootKeep]);

    const replyEdit = await asTrusted.mutation(api.forum.updatePostContent, {
      postId: seed.publicPostId,
      body: "Public reply about lunar launch logs.",
      attachmentIdsToKeep: [attachmentIds.replyKeep],
      attachments: [],
      editReason: "Prune stale reply file",
    });
    expect(replyEdit.updated).toBe(true);
    expect(
      replyEdit.post.attachments?.map((attachment) => attachment._id),
    ).toEqual([attachmentIds.replyKeep]);

    const noOpReplyEdit = await asTrusted.mutation(
      api.forum.updatePostContent,
      {
        postId: seed.publicPostId,
        body: "Public reply about lunar launch logs.",
        attachmentIdsToKeep: [attachmentIds.replyKeep],
        attachments: [],
      },
    );
    expect(noOpReplyEdit.updated).toBe(false);
    expect(
      noOpReplyEdit.post.attachments?.map((attachment) => attachment._id),
    ).toEqual([attachmentIds.replyKeep]);

    const detail = await asTrusted.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
    });
    expect(
      detail.thread?.attachments.map((attachment) => attachment._id),
    ).toEqual([attachmentIds.rootKeep]);
    expect(
      detail.replies.page
        .find((post) => post._id === seed.publicPostId)
        ?.attachments?.map((attachment) => attachment._id),
    ).toEqual([attachmentIds.replyKeep]);

    const rows = await t.run(async (ctx) => ({
      rootRemove: await ctx.db.get(attachmentIds.rootRemove),
      replyRemove: await ctx.db.get(attachmentIds.replyRemove),
    }));
    expect(rows.rootRemove).toMatchObject({
      status: "deleted",
      deletedBy: seed.trustedUserId,
    });
    expect(rows.replyRemove).toMatchObject({
      status: "deleted",
      deletedBy: seed.trustedUserId,
    });
  });

  test("thread and board watches toggle predictably and lists only show active visible subscriptions", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });
    const asUntrusted = t.withIdentity({
      subject: seed.untrustedUserId,
      name: "New Member",
    });

    await expect(
      t.mutation(api.forum.toggleThreadSubscription, {
        threadId: seed.publicThreadId,
      }),
    ).rejects.toThrow(/Sign in/);
    await expect(
      t.mutation(api.forum.toggleCategorySubscription, {
        categorySlug: "public-square",
      }),
    ).rejects.toThrow(/Sign in/);
    await expect(
      asUntrusted.mutation(api.forum.toggleThreadSubscription, {
        threadId: seed.trustedThreadId,
      }),
    ).rejects.toThrow(/not available/);

    const firstThreadToggle = await asOtherTrusted.mutation(
      api.forum.toggleThreadSubscription,
      { threadId: seed.publicThreadId },
    );
    expect(firstThreadToggle).toMatchObject({ subscribed: true });
    await expect(
      asOtherTrusted.query(api.forum.listMyThreadSubscriptions, { limit: 10 }),
    ).resolves.toMatchObject({
      threads: [expect.objectContaining({ _id: seed.publicThreadId })],
    });

    const secondThreadToggle = await asOtherTrusted.mutation(
      api.forum.toggleThreadSubscription,
      { threadId: seed.publicThreadId },
    );
    expect(secondThreadToggle).toMatchObject({
      subscribed: false,
      subscriptionId: firstThreadToggle.subscriptionId,
    });
    await expect(
      asOtherTrusted.query(api.forum.listMyThreadSubscriptions, { limit: 10 }),
    ).resolves.toMatchObject({ threads: [] });

    const thirdThreadToggle = await asOtherTrusted.mutation(
      api.forum.toggleThreadSubscription,
      { threadId: seed.publicThreadId },
    );
    expect(thirdThreadToggle).toMatchObject({
      subscribed: true,
      subscriptionId: firstThreadToggle.subscriptionId,
    });

    const firstCategoryToggle = await asOtherTrusted.mutation(
      api.forum.toggleCategorySubscription,
      { categorySlug: "public-square" },
    );
    expect(firstCategoryToggle).toMatchObject({ subscribed: true });
    await expect(
      asOtherTrusted.query(api.forum.listMyCategorySubscriptions, {
        limit: 10,
      }),
    ).resolves.toMatchObject({
      categories: [expect.objectContaining({ _id: seed.publicCategoryId })],
    });

    const secondCategoryToggle = await asOtherTrusted.mutation(
      api.forum.toggleCategorySubscription,
      { categorySlug: "public-square" },
    );
    expect(secondCategoryToggle).toMatchObject({
      subscribed: false,
      subscriptionId: firstCategoryToggle.subscriptionId,
    });
    await expect(
      asOtherTrusted.query(api.forum.listMyCategorySubscriptions, {
        limit: 10,
      }),
    ).resolves.toMatchObject({ categories: [] });

    await t.run(async (ctx) => {
      const now = 1_800_000_000_300;
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: seed.untrustedUserId,
        threadId: seed.trustedThreadId,
        categoryId: seed.trustedCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("forumCategorySubscriptions", {
        userId: seed.untrustedUserId,
        categoryId: seed.trustedCategoryId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      asUntrusted.query(api.forum.listMyThreadSubscriptions, { limit: 10 }),
    ).resolves.toMatchObject({ threads: [] });
    await expect(
      asUntrusted.query(api.forum.listMyCategorySubscriptions, { limit: 10 }),
    ).resolves.toMatchObject({ categories: [] });
  });

  test("thread bookmarks stay private, remain separate from watches, and honor current board visibility", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });
    const asUntrusted = t.withIdentity({
      subject: seed.untrustedUserId,
      name: "New Member",
    });

    await expect(
      t.mutation(api.forum.setThreadBookmark, {
        threadId: seed.publicThreadId,
        saved: true,
      }),
    ).rejects.toThrow(/Sign in/);
    await expect(
      t.query(api.forum.listMyThreadBookmarks, { limit: 10 }),
    ).rejects.toThrow(/Sign in/);
    await expect(
      asUntrusted.mutation(api.forum.setThreadBookmark, {
        threadId: seed.trustedThreadId,
        saved: true,
      }),
    ).rejects.toThrow(/not available/);

    const before = await asOtherTrusted.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
    });
    expect(before.thread?.viewerBookmarked).toBe(false);

    const saved = await asOtherTrusted.mutation(api.forum.setThreadBookmark, {
      threadId: seed.publicThreadId,
      saved: true,
    });
    expect(saved).toMatchObject({ saved: true });

    const afterSave = await asOtherTrusted.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
    });
    expect(afterSave.thread?.viewerBookmarked).toBe(true);
    await expect(
      asOtherTrusted.query(api.forum.listMyThreadBookmarks, { limit: 10 }),
    ).resolves.toMatchObject({
      threads: [
        expect.objectContaining({
          _id: seed.publicThreadId,
          categoryName: "Public Square",
        }),
      ],
    });
    await expect(
      asOtherTrusted.query(api.forum.listMyThreadSubscriptions, { limit: 10 }),
    ).resolves.toMatchObject({ threads: [] });

    await t.run(async (ctx) => {
      const now = 1_800_000_000_310;
      await ctx.db.insert("forumThreadBookmarks", {
        userId: seed.untrustedUserId,
        threadId: seed.trustedThreadId,
        categoryId: seed.trustedCategoryId,
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      asUntrusted.query(api.forum.listMyThreadBookmarks, { limit: 10 }),
    ).resolves.toMatchObject({ threads: [] });

    const removed = await asOtherTrusted.mutation(api.forum.setThreadBookmark, {
      threadId: seed.publicThreadId,
      saved: false,
    });
    expect(removed).toMatchObject({
      saved: false,
      bookmarkId: saved.bookmarkId,
    });
    const afterRemove = await asOtherTrusted.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
    });
    expect(afterRemove.thread?.viewerBookmarked).toBe(false);
    await expect(
      asOtherTrusted.query(api.forum.listMyThreadBookmarks, { limit: 10 }),
    ).resolves.toMatchObject({ threads: [] });
  });

  test("authors can delete reply-free threads while counters, profiles, and audit rows stay consistent", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    const thread = await asOtherTrusted.mutation(api.forum.createThread, {
      categorySlug: "public-square",
      title: "Deletable launch checklist",
      body: "A reply-free thread can still be withdrawn by its author.",
    });
    const before = await t.run(async (ctx) => ({
      category: await ctx.db.get(seed.publicCategoryId),
      profile: await ctx.db
        .query("forumUserProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", seed.otherTrustedUserId))
        .unique(),
    }));

    await expect(
      t.mutation(api.forum.deleteThread, { threadId: thread.threadId }),
    ).rejects.toThrow(/Sign in/);
    await expect(
      asTrusted.mutation(api.forum.deleteThread, {
        threadId: thread.threadId,
      }),
    ).rejects.toThrow(/You cannot delete this thread/);

    await expect(
      asOtherTrusted.mutation(api.forum.deleteThread, {
        threadId: thread.threadId,
      }),
    ).resolves.toMatchObject({
      deleted: true,
      categorySlug: "public-square",
    });

    const snapshot = await t.run(async (ctx) => {
      const events = await ctx.db
        .query("forumModerationEvents")
        .withIndex("by_eventType_and_createdAt", (q) =>
          q.eq("eventType", "forum_thread_deleted"),
        )
        .take(5);
      const event = events.find((row) => row.entityId === thread.threadId);
      return {
        category: await ctx.db.get(seed.publicCategoryId),
        event:
          event === undefined
            ? null
            : { ...event, metadata: JSON.parse(event.metadataJson) },
        profile: await ctx.db
          .query("forumUserProfiles")
          .withIndex("by_userId", (q) =>
            q.eq("userId", seed.otherTrustedUserId),
          )
          .unique(),
        thread: await ctx.db.get(thread.threadId),
      };
    });

    expect(snapshot.thread).toMatchObject({
      status: "deleted",
      deletedBy: seed.otherTrustedUserId,
      deletedAt: expect.any(Number),
    });
    expect(snapshot.category).toMatchObject({
      threadCount: Math.max(0, (before.category?.threadCount ?? 0) - 1),
      postCount: Math.max(0, (before.category?.postCount ?? 0) - 1),
    });
    expect(before.profile).toMatchObject({ threadCount: 1, postCount: 1 });
    expect(snapshot.profile).toMatchObject({ threadCount: 0, postCount: 0 });
    expect(snapshot.event).toMatchObject({
      entityType: "forumThread",
      entityId: thread.threadId,
      metadata: {
        previousStatus: "active",
        nextStatus: "deleted",
        actorWasModerator: false,
      },
    });
  });

  test("reply deletes enforce authorship and update thread, board, profile, and audit state", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("forumUserProfiles", {
        userId: seed.trustedUserId,
        showSignatures: true,
        threadCount: 1,
        postCount: 1,
        createdAt: 1_800_000_000_200,
        updatedAt: 1_800_000_000_200,
      });
    });

    await expect(
      t.mutation(api.forum.deletePost, { postId: seed.publicPostId }),
    ).rejects.toThrow(/Sign in/);
    await expect(
      asOtherTrusted.mutation(api.forum.deletePost, {
        postId: seed.publicPostId,
      }),
    ).rejects.toThrow(/cannot delete this reply/);

    await expect(
      asTrusted.mutation(api.forum.deletePost, {
        postId: seed.publicPostId,
      }),
    ).resolves.toMatchObject({
      deleted: true,
      threadId: seed.publicThreadId,
    });

    const snapshot = await t.run(async (ctx) => {
      const events = await ctx.db
        .query("forumModerationEvents")
        .withIndex("by_eventType_and_createdAt", (q) =>
          q.eq("eventType", "forum_post_deleted"),
        )
        .take(5);
      const event = events.find((row) => row.entityId === seed.publicPostId);
      return {
        category: await ctx.db.get(seed.publicCategoryId),
        event:
          event === undefined
            ? null
            : { ...event, metadata: JSON.parse(event.metadataJson) },
        post: await ctx.db.get(seed.publicPostId),
        profile: await ctx.db
          .query("forumUserProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", seed.trustedUserId))
          .unique(),
        thread: await ctx.db.get(seed.publicThreadId),
      };
    });

    expect(snapshot.post).toMatchObject({
      status: "deleted",
      deletedBy: seed.trustedUserId,
      deletedAt: expect.any(Number),
    });
    expect(snapshot.thread).toMatchObject({ replyCount: 0 });
    expect(snapshot.category).toMatchObject({ postCount: 1 });
    expect(snapshot.profile).toMatchObject({ threadCount: 1, postCount: 0 });
    expect(snapshot.event).toMatchObject({
      entityType: "forumPost",
      entityId: seed.publicPostId,
      metadata: {
        previousStatus: "active",
        nextStatus: "deleted",
        actorWasModerator: false,
      },
    });
  });

  test("polls can be edited until voting starts", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const pollId = await t.run(
      async (ctx) =>
        await insertPoll(ctx, {
          threadId: seed.publicThreadId,
          categoryId: seed.publicCategoryId,
          question: "Which launch window should we use?",
          options: ["Morning", "Evening"],
          now: 1_800_000_000_100,
        }),
    );
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    const initialSearch = await asTrusted.query(api.forum.search, {
      query: "morning",
      resultType: "threads",
      pageSize: 10,
    });
    expect(initialSearch.threads.map((thread) => thread.slug)).toContain(
      "public-lunar-brief",
    );

    await expect(
      asOtherTrusted.mutation(api.forum.updatePollContent, {
        pollId,
        question: "Which nebula should we study?",
        options: ["Orion", "Crab"],
      }),
    ).rejects.toThrow(/only edit polls/);

    await expect(
      asTrusted.mutation(api.forum.updatePollContent, {
        pollId,
        question: "Which nebula should we study?",
        options: ["Orion", "Crab"],
      }),
    ).resolves.toMatchObject({ updated: true });

    const detail = await asTrusted.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
      pageSize: 5,
    });
    expect(detail.poll).toMatchObject({
      question: "Which nebula should we study?",
      viewerCanEdit: true,
    });
    expect(detail.poll?.options.map((option) => option.label)).toEqual([
      "Orion",
      "Crab",
    ]);

    const search = await asTrusted.query(api.forum.search, {
      query: "nebula",
      resultType: "threads",
      pageSize: 10,
    });
    expect(search.threads.map((thread) => thread.slug)).toContain(
      "public-lunar-brief",
    );

    const staleSearch = await asTrusted.query(api.forum.search, {
      query: "morning",
      resultType: "threads",
      pageSize: 10,
    });
    expect(staleSearch.threads.map((thread) => thread.slug)).not.toContain(
      "public-lunar-brief",
    );

    await asTrusted.mutation(api.forum.votePoll, {
      pollId,
      optionId: detail.poll!.options[0]._id,
    });
    await expect(
      asTrusted.mutation(api.forum.updatePollContent, {
        pollId,
        question: "Which nebula should we study next?",
        options: ["Orion", "Crab"],
      }),
    ).rejects.toThrow(/after voting has started/);
  });

  test("member polls invite sign-in, accept a vote, and reveal results only afterward", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const pollId = await t.run(async (ctx) => {
      await ctx.db.patch(seed.publicCategoryId, { pollAccess: "members" });
      return await insertPoll(ctx, {
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        question: "Which launch window should we use?",
        options: ["Morning", "Evening"],
        now: 1_800_000_000_150,
      });
    });
    const asMember = t.withIdentity({
      subject: seed.untrustedUserId,
      name: "New Member",
    });

    const guestDetail = await t.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
      pageSize: 5,
    });
    expect(guestDetail.poll).toMatchObject({
      viewerCanSeeResults: false,
      viewerCanVote: false,
      totalVotes: 0,
      options: [
        { label: "Morning", voteCount: 0, percent: 0 },
        { label: "Evening", voteCount: 0, percent: 0 },
      ],
    });

    const memberDetail = await asMember.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
      pageSize: 5,
    });
    expect(memberDetail.poll).toMatchObject({
      viewerCanSeeResults: false,
      viewerCanVote: true,
    });

    await expect(
      asMember.mutation(api.forum.votePoll, {
        pollId,
        optionId: memberDetail.poll!.options[0]._id,
      }),
    ).resolves.toMatchObject({ voted: true });

    const votedDetail = await asMember.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
      pageSize: 5,
    });
    expect(votedDetail.poll).toMatchObject({
      viewerCanSeeResults: true,
      viewerCanVote: false,
      viewerOptionId: memberDetail.poll!.options[0]._id,
      totalVotes: 1,
      options: [
        { label: "Morning", voteCount: 1, percent: 100 },
        { label: "Evening", voteCount: 0, percent: 0 },
      ],
    });

    const guestAfterVote = await t.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
      pageSize: 5,
    });
    expect(guestAfterVote.poll).toMatchObject({
      viewerCanSeeResults: false,
      totalVotes: 0,
      options: [
        { voteCount: 0, percent: 0 },
        { voteCount: 0, percent: 0 },
      ],
    });
  });

  test("closed zero-vote polls cannot be edited", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const pollId = await t.run(async (ctx) => {
      const insertedPollId = await insertPoll(ctx, {
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        question: "Should this poll stay frozen?",
        options: ["Yes", "No"],
        now: 1_800_000_000_200,
      });
      await ctx.db.patch(insertedPollId, {
        status: "closed",
        closedAt: 1_800_000_000_250,
        closedBy: seed.ownerId,
        updatedAt: 1_800_000_000_250,
      });
      return insertedPollId;
    });
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    const detail = await asTrusted.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
      pageSize: 5,
    });
    expect(detail.poll).toMatchObject({
      status: "closed",
      totalVotes: 0,
      viewerCanEdit: false,
    });

    await expect(
      asTrusted.mutation(api.forum.updatePollContent, {
        pollId,
        question: "Can this closed poll change?",
        options: ["Yes", "No"],
      }),
    ).rejects.toThrow(/Closed polls cannot be edited/);
  });

  test("forum buddy and ignore lists can be managed by trusted members", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    await expect(
      asTrusted.mutation(api.forum.updateForumRelationship, {
        username: "trustedauthor",
        kind: "buddy",
        enabled: true,
      }),
    ).rejects.toThrow(/Choose another forum member/);

    await expect(
      asTrusted.mutation(api.forum.updateForumRelationship, {
        username: "othertrusted",
        kind: "buddy",
        enabled: true,
      }),
    ).resolves.toMatchObject({
      enabled: true,
      kind: "buddy",
      record: { username: "othertrusted", kind: "buddy" },
    });
    await asTrusted.mutation(api.forum.updateForumRelationship, {
      username: "othertrusted",
      kind: "buddy",
      enabled: true,
    });
    await asTrusted.mutation(api.forum.updateForumRelationship, {
      username: "othertrusted",
      kind: "ignore",
      enabled: true,
    });

    const relationships = await asTrusted.query(
      api.forum.listMyForumRelationships,
      { limit: 10 },
    );
    expect(relationships.buddies.map((record) => record.username)).toEqual([
      "othertrusted",
    ]);
    expect(relationships.ignored.map((record) => record.username)).toEqual([
      "othertrusted",
    ]);

    await expect(
      asTrusted.mutation(api.forum.updateForumRelationship, {
        username: "othertrusted",
        kind: "buddy",
        enabled: false,
      }),
    ).resolves.toMatchObject({
      enabled: false,
      kind: "buddy",
      username: "othertrusted",
    });
    const afterRemoval = await asTrusted.query(
      api.forum.listMyForumRelationships,
      { limit: 10 },
    );
    expect(afterRemoval.buddies).toHaveLength(0);
    expect(afterRemoval.ignored).toHaveLength(1);
  });

  test("members can mark all visible forums read", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asUntrusted = t.withIdentity({
      subject: seed.untrustedUserId,
      name: "New Member",
    });
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });

    await expect(t.mutation(api.forum.markAllForumsRead, {})).rejects.toThrow(
      /Sign in/,
    );

    await expect(
      asUntrusted.mutation(api.forum.markAllForumsRead, {}),
    ).resolves.toMatchObject({ marked: true, categoryCount: 1 });

    const untrustedReads = await t.run(async (ctx) => {
      const publicRead = await ctx.db
        .query("forumCategoryReads")
        .withIndex("by_userId_and_categoryId", (q) =>
          q
            .eq("userId", seed.untrustedUserId)
            .eq("categoryId", seed.publicCategoryId),
        )
        .unique();
      const trustedRead = await ctx.db
        .query("forumCategoryReads")
        .withIndex("by_userId_and_categoryId", (q) =>
          q
            .eq("userId", seed.untrustedUserId)
            .eq("categoryId", seed.trustedCategoryId),
        )
        .unique();
      return { publicRead, trustedRead };
    });
    expect(untrustedReads.publicRead).toMatchObject({
      userId: seed.untrustedUserId,
      categoryId: seed.publicCategoryId,
    });
    expect(untrustedReads.trustedRead).toBeNull();

    await expect(
      asTrusted.mutation(api.forum.markAllForumsRead, {}),
    ).resolves.toMatchObject({ marked: true, categoryCount: 2 });
    const trustedReads = await t.run(async (ctx) => {
      const publicRead = await ctx.db
        .query("forumCategoryReads")
        .withIndex("by_userId_and_categoryId", (q) =>
          q
            .eq("userId", seed.trustedUserId)
            .eq("categoryId", seed.publicCategoryId),
        )
        .unique();
      const trustedRead = await ctx.db
        .query("forumCategoryReads")
        .withIndex("by_userId_and_categoryId", (q) =>
          q
            .eq("userId", seed.trustedUserId)
            .eq("categoryId", seed.trustedCategoryId),
        )
        .unique();
      return { publicRead, trustedRead };
    });
    expect(trustedReads.publicRead).toMatchObject({
      userId: seed.trustedUserId,
      categoryId: seed.publicCategoryId,
    });
    expect(trustedReads.trustedRead).toMatchObject({
      userId: seed.trustedUserId,
      categoryId: seed.trustedCategoryId,
    });
  });

  test("overview exposes viewer board unread state", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });
    const boardBySlug = (
      overview: {
        categories: Array<{
          slug: string;
          viewerHasRead?: boolean;
          viewerUnread?: boolean;
        }>;
      },
      slug: string,
    ) => overview.categories.find((category) => category.slug === slug);
    const readAt = 1_800_000_010_000;

    const initial = await asTrusted.query(api.forum.overview, {});
    expect(boardBySlug(initial, "public-square")).toMatchObject({
      viewerUnread: true,
      viewerHasRead: false,
    });
    expect(boardBySlug(initial, "trusted-lab")).toMatchObject({
      viewerUnread: true,
      viewerHasRead: false,
    });

    vi.useFakeTimers();
    vi.setSystemTime(readAt);
    try {
      await asTrusted.mutation(api.forum.markAllForumsRead, {});
      const afterMarkRead = await asTrusted.query(api.forum.overview, {});
      expect(boardBySlug(afterMarkRead, "public-square")).toMatchObject({
        viewerUnread: false,
        viewerHasRead: true,
      });
      expect(boardBySlug(afterMarkRead, "trusted-lab")).toMatchObject({
        viewerUnread: false,
        viewerHasRead: true,
      });

      vi.setSystemTime(readAt + 500);
      await asOwner.mutation(api.forum.moveForumPosts, {
        postIds: [seed.publicPostId],
        targetThreadId: seed.trustedThreadId,
        moderationReason: "Wrong board",
      });
      const afterMove = await asTrusted.query(api.forum.overview, {});
      expect(boardBySlug(afterMove, "trusted-lab")).toMatchObject({
        viewerUnread: true,
        viewerHasRead: false,
      });
    } finally {
      vi.useRealTimers();
    }

    const guestOverview = await t.query(api.forum.overview, {});
    expect(boardBySlug(guestOverview, "public-square")?.viewerUnread).toBe(
      undefined,
    );
  });

  test("online roster only lists active trusted forum members", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("forumPresence", {
        userId: seed.trustedUserId,
        locationType: "thread",
        path: "/forum/public-square/public-lunar-brief",
        label: "Reading thread",
        lastSeenAt: now - 1_000,
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
      });
      await ctx.db.insert("forumPresence", {
        userId: seed.otherTrustedUserId,
        locationType: "online",
        path: "/forum/online",
        label: "Who's online",
        lastSeenAt: now - 2_000,
        createdAt: now - 2_000,
        updatedAt: now - 2_000,
      });
      await ctx.db.insert("forumPresence", {
        userId: seed.untrustedUserId,
        locationType: "index",
        path: "/forum",
        label: "Board index",
        lastSeenAt: now - 500,
        createdAt: now - 500,
        updatedAt: now - 500,
      });
      await ctx.db.insert("forumPresence", {
        userId: seed.ownerId,
        locationType: "members",
        path: "/forum/members",
        label: "Member directory",
        lastSeenAt: now - 30 * 60 * 1_000,
        createdAt: now - 30 * 60 * 1_000,
        updatedAt: now - 30 * 60 * 1_000,
      });
    });

    const firstPage = await t.query(api.forum.listOnlineMembers, {
      page: 1,
      pageSize: 1,
    });
    expect(firstPage.registeredCount).toBe(2);
    expect(firstPage.members).toHaveLength(1);
    expect(firstPage.members[0]).toMatchObject({
      username: "trustedauthor",
      location: { label: "Reading thread" },
    });
    expect(firstPage.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      totalItems: 2,
    });

    const secondPage = await t.query(api.forum.listOnlineMembers, {
      page: 2,
      pageSize: 1,
    });
    expect(secondPage.members).toHaveLength(1);
    expect(secondPage.members[0]).toMatchObject({
      username: "othertrusted",
      location: {
        href: "/forum/online",
        label: "Who's online",
        type: "online",
      },
    });
  });

  test("online roster maps calendar presence activity", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("forumPresence", {
        userId: seed.trustedUserId,
        locationType: "calendar",
        path: "/forum/calendar",
        label: "Browsing calendar",
        lastSeenAt: now - 1_000,
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
      });
    });

    const roster = await t.query(api.forum.listOnlineMembers, {
      page: 1,
      pageSize: 10,
    });
    expect(roster.members[0]).toMatchObject({
      username: "trustedauthor",
      location: {
        href: "/forum/calendar",
        label: "Browsing calendar",
        type: "calendar",
      },
    });
  });

  test("public profile presence maps help desk and calendar activity", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const now = Date.now();

    let presenceId: Id<"forumPresence"> | null = null;
    await t.run(async (ctx) => {
      presenceId = await ctx.db.insert("forumPresence", {
        userId: seed.trustedUserId,
        locationType: "help",
        path: "/forum/help",
        label: "Reading help",
        lastSeenAt: now - 1_000,
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
      });
    });
    if (presenceId === null) {
      throw new Error("Presence was not seeded");
    }
    const seededPresenceId = presenceId;

    const profile = await t.query(api.users.publicProfile, {
      username: "trustedauthor",
    });

    expect(profile?.forumProfile).toMatchObject({
      isOnline: true,
      onlineLocation: {
        href: "/forum/help",
        label: "Reading help",
      },
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(seededPresenceId, {
        locationType: "calendar",
        path: "/forum/calendar",
        label: "Browsing calendar",
        lastSeenAt: now,
        updatedAt: now,
      });
    });

    const calendarProfile = await t.query(api.users.publicProfile, {
      username: "trustedauthor",
    });

    expect(calendarProfile?.forumProfile).toMatchObject({
      isOnline: true,
      onlineLocation: {
        href: "/forum/calendar",
        label: "Browsing calendar",
      },
    });
  });

  test("private messages stay scoped to sender and recipient", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });

    const { messageId } = await asTrusted.mutation(
      api.forum.sendPrivateMessage,
      {
        recipientUsername: "othertrusted",
        subject: "Launch privacy",
        body: "This private message should stay private.",
      },
    );

    await expect(
      asTrusted.query(api.forum.getPrivateMessage, {
        messageId,
        box: "sent",
      }),
    ).resolves.toMatchObject({
      _id: messageId,
      box: "sent",
      subject: "Launch privacy",
    });
    await expect(
      asOtherTrusted.query(api.forum.getPrivateMessage, { messageId }),
    ).resolves.toMatchObject({
      _id: messageId,
      box: "inbox",
      subject: "Launch privacy",
    });
    await expect(
      asOwner.query(api.forum.getPrivateMessage, { messageId }),
    ).rejects.toThrow(/not available/);

    const ownerInbox = await asOwner.query(api.forum.listPrivateMessages, {
      box: "inbox",
      pageSize: 10,
    });
    expect(ownerInbox.messages.map((message) => message._id)).not.toContain(
      messageId,
    );

    await expect(
      asTrusted.mutation(api.forum.markPrivateMessageRead, { messageId }),
    ).rejects.toThrow(/not available/);
    await expect(
      asOwner.mutation(api.forum.markPrivateMessageRead, { messageId }),
    ).rejects.toThrow(/not available/);
    await expect(
      asOwner.mutation(api.forum.deletePrivateMessage, {
        messageId,
        box: "inbox",
      }),
    ).rejects.toThrow(/not available/);
    await expect(
      asOwner.mutation(api.forum.restorePrivateMessage, { messageId }),
    ).rejects.toThrow(/not available/);
    await expect(
      asTrusted.mutation(api.forum.createPrivateMessageReport, {
        messageId,
        reason: "Sender cannot report sent copy",
      }),
    ).rejects.toThrow(/not available/);
    await expect(
      asOwner.mutation(api.forum.createPrivateMessageReport, {
        messageId,
        reason: "Outsider cannot report",
      }),
    ).rejects.toThrow(/not available/);
  });

  test("private message report bodies are visible to moderators and forum admins", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const staff = await t.run(async (ctx) => {
      const now = 1_800_000_000_050;
      const moderatorId = await ctx.db.insert("users", {
        name: "Forum Moderator",
        username: "forummod",
        usernameNormalized: "forummod",
        forumRole: "moderator",
        forumRoleAssignedAt: now,
        forumRoleAssignedBy: seed.ownerId,
      });
      const forumAdminId = await ctx.db.insert("users", {
        name: "Forum Admin",
        username: "forumadmin",
        usernameNormalized: "forumadmin",
        forumRole: "admin",
        forumRoleAssignedAt: now,
        forumRoleAssignedBy: seed.ownerId,
      });
      return { forumAdminId, moderatorId };
    });
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });
    const asModerator = t.withIdentity({
      subject: staff.moderatorId,
      name: "Forum Moderator",
    });
    const asForumAdmin = t.withIdentity({
      subject: staff.forumAdminId,
      name: "Forum Admin",
    });
    const secretBody =
      "Secret launch coordinates are inside this private message.";

    const { messageId } = await asTrusted.mutation(
      api.forum.sendPrivateMessage,
      {
        recipientUsername: "othertrusted",
        subject: "Launch privacy",
        body: secretBody,
      },
    );
    const reportResult = await asOtherTrusted.mutation(
      api.forum.createPrivateMessageReport,
      {
        messageId,
        reason: "Private message abuse report",
      },
    );

    const moderatorReports = await asModerator.query(
      api.forum.listForumReports,
      { status: "open", limit: 10 },
    );
    const moderatorReport = moderatorReports.find(
      (report) => report._id === reportResult.reportId,
    );
    expect(moderatorReport).toMatchObject({
      _id: reportResult.reportId,
      entityType: "privateMessage",
      snapshotTitle: "Launch privacy",
      snapshotBody: secretBody,
    });
    expect(moderatorReport?.excerpt).toContain("Secret launch coordinates");

    const adminReports = await asForumAdmin.query(api.forum.listForumReports, {
      status: "open",
      limit: 10,
    });
    const adminReport = adminReports.find(
      (report) => report._id === reportResult.reportId,
    );
    expect(adminReport).toMatchObject({
      _id: reportResult.reportId,
      entityType: "privateMessage",
      snapshotTitle: "Launch privacy",
      snapshotBody: secretBody,
    });
    expect(adminReport?.excerpt).toContain("Secret launch coordinates");
  });

  test("warnings issued from reports also audit the report review", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });

    const reportResult = await asOtherTrusted.mutation(api.forum.createReport, {
      entityType: "post",
      threadId: seed.publicThreadId,
      postId: seed.publicPostId,
      reason: "Needs moderator review",
    });

    const warningResult = await asOwner.mutation(api.forum.issueForumWarning, {
      targetUserId: seed.trustedUserId,
      points: 1,
      reason: "Keep the launch notes tidy",
      moderationNote: "Warning closes the report.",
      reportId: reportResult.reportId,
    });

    expect(warningResult.report).toMatchObject({
      _id: reportResult.reportId,
      status: "reviewed",
      moderationNote: "Warning closes the report.",
    });

    const audit = await t.run(async (ctx) => {
      const events = await ctx.db
        .query("forumModerationEvents")
        .withIndex("by_eventType_and_createdAt", (q) =>
          q.eq("eventType", "forum_report_updated"),
        )
        .take(5);
      return events.map((event) => ({
        ...event,
        metadata: JSON.parse(event.metadataJson),
      }));
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityType: "forumReport",
      entityId: reportResult.reportId,
      reportId: reportResult.reportId,
      warningId: warningResult.warning._id,
      metadata: {
        previousStatus: "open",
        nextStatus: "reviewed",
        warningId: warningResult.warning._id,
      },
    });
  });

  test("ignored members cannot send private messages until removed", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await asTrusted.mutation(api.forum.updateForumRelationship, {
      username: "othertrusted",
      kind: "ignore",
      enabled: true,
    });

    await expect(
      asOtherTrusted.mutation(api.forum.sendPrivateMessage, {
        recipientUsername: "trustedauthor",
        subject: "Launch notes",
        body: "Can you see this?",
      }),
    ).rejects.toThrow(/not accepting private messages/);

    await asTrusted.mutation(api.forum.updateForumRelationship, {
      username: "othertrusted",
      kind: "ignore",
      enabled: false,
    });

    await expect(
      asOtherTrusted.mutation(api.forum.sendPrivateMessage, {
        recipientUsername: "trustedauthor",
        subject: "Launch notes",
        body: "Can you see this now?",
      }),
    ).resolves.toMatchObject({ messageId: expect.any(String) });
  });

  test("trusted members can rate visible threads once and update or clear their rating", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOtherTrusted = t.withIdentity({
      subject: seed.otherTrustedUserId,
      name: "Other Trusted",
    });

    await expect(
      asOtherTrusted.mutation(api.forum.rateThread, {
        threadId: seed.publicThreadId,
        score: 5,
      }),
    ).resolves.toMatchObject({
      threadId: seed.publicThreadId,
      viewerRating: 5,
      ratingCount: 1,
      ratingAverage: 5,
    });

    let detail = await asOtherTrusted.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
      pageSize: 5,
    });
    expect(detail.thread).toMatchObject({
      ratingCount: 1,
      ratingAverage: 5,
      viewerCanRateThread: true,
      viewerRating: 5,
    });

    await expect(
      asOtherTrusted.mutation(api.forum.rateThread, {
        threadId: seed.publicThreadId,
        score: 3,
      }),
    ).resolves.toMatchObject({
      viewerRating: 3,
      ratingCount: 1,
      ratingAverage: 3,
    });

    detail = await asOtherTrusted.query(api.forum.getThread, {
      categorySlug: "public-square",
      threadSlug: "public-lunar-brief",
      pageSize: 5,
    });
    expect(detail.thread).toMatchObject({
      ratingCount: 1,
      ratingAverage: 3,
      viewerRating: 3,
    });

    await expect(
      asOtherTrusted.mutation(api.forum.rateThread, {
        threadId: seed.publicThreadId,
        score: null,
      }),
    ).resolves.toMatchObject({
      viewerRating: 0,
      ratingCount: 0,
      ratingAverage: 0,
    });

    const snapshot = await t.run(async (ctx) => {
      const thread = await ctx.db.get(seed.publicThreadId);
      const ratings = await ctx.db
        .query("forumThreadRatings")
        .withIndex("by_threadId_and_updatedAt", (q) =>
          q.eq("threadId", seed.publicThreadId),
        )
        .take(5);
      return { ratings, thread };
    });
    expect(snapshot.thread).toMatchObject({
      ratingCount: 0,
      ratingTotal: 0,
    });
    expect(snapshot.ratings).toEqual([]);
  });

  test("thread ratings require trusted non-author participation", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asAuthor = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asUntrusted = t.withIdentity({
      subject: seed.untrustedUserId,
      name: "New Member",
    });

    await expect(
      asAuthor.mutation(api.forum.rateThread, {
        threadId: seed.publicThreadId,
        score: 4,
      }),
    ).rejects.toThrow(/cannot rate your own thread/);

    await expect(
      asUntrusted.mutation(api.forum.rateThread, {
        threadId: seed.publicThreadId,
        score: 4,
      }),
    ).rejects.toThrow(/approve your forum access/);
  });

  test("admins move active replies with related moderation records", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const related = await t.run(async (ctx) => {
      const now = 1_800_000_000_500;
      const editId = await ctx.db.insert("forumContentEdits", {
        entityType: "post",
        threadId: seed.publicThreadId,
        postId: seed.publicPostId,
        actorUserId: seed.trustedUserId,
        targetUserId: seed.trustedUserId,
        previousBody: "Draft public reply.",
        nextBody: "Public reply about lunar launch logs.",
        editReason: "Clarified launch notes",
        createdAt: now,
      });
      const reportId = await ctx.db.insert("forumReports", {
        reporterId: seed.otherTrustedUserId,
        entityType: "post",
        threadId: seed.publicThreadId,
        postId: seed.publicPostId,
        categoryId: seed.publicCategoryId,
        snapshotBody: "Public reply about lunar launch logs.",
        snapshotAuthorId: seed.trustedUserId,
        snapshotAuthorName: "Trusted Author",
        snapshotPostNumber: 2,
        snapshotCreatedAt: 1_800_000_000_003,
        reason: "Wrong board",
        status: "open",
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      const warningId = await ctx.db.insert("forumWarnings", {
        targetUserId: seed.trustedUserId,
        actorUserId: seed.ownerId,
        status: "active",
        points: 1,
        reason: "Keep topics tidy",
        categoryId: seed.publicCategoryId,
        threadId: seed.publicThreadId,
        postId: seed.publicPostId,
        reportId,
        createdAt: now + 2,
        updatedAt: now + 2,
      });
      const reputationId = await ctx.db.insert("forumReputations", {
        fromUserId: seed.otherTrustedUserId,
        toUserId: seed.trustedUserId,
        targetType: "post",
        targetKey: `post:${seed.publicPostId}`,
        threadId: seed.publicThreadId,
        postId: seed.publicPostId,
        categoryId: seed.publicCategoryId,
        score: 1,
        comment: "Useful reply",
        createdAt: now + 3,
        updatedAt: now + 3,
      });
      const notificationId = await ctx.db.insert("forumNotifications", {
        recipientUserId: seed.otherTrustedUserId,
        actorUserId: seed.trustedUserId,
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        postId: seed.publicPostId,
        type: "reply",
        status: "unread",
        createdAt: now + 4,
        updatedAt: now + 4,
      });
      const emailDeliveryId = await ctx.db.insert(
        "forumNotificationEmailDeliveries",
        {
          notificationId,
          recipientUserId: seed.otherTrustedUserId,
          actorUserId: seed.trustedUserId,
          threadId: seed.publicThreadId,
          categoryId: seed.publicCategoryId,
          postId: seed.publicPostId,
          type: "reply",
          status: "queued",
          toEmail: "other@example.com",
          createdAt: now + 5,
          updatedAt: now + 5,
        },
      );
      const relatedEventId = await ctx.db.insert("forumModerationEvents", {
        actorUserId: seed.ownerId,
        entityType: "forumPost",
        entityId: seed.publicPostId,
        eventType: "forum_post_moderated",
        message: "Post reviewed before move",
        categoryId: seed.publicCategoryId,
        threadId: seed.publicThreadId,
        postId: seed.publicPostId,
        metadataJson: "{}",
        createdAt: now + 6,
      });
      return {
        editId,
        emailDeliveryId,
        notificationId,
        relatedEventId,
        reportId,
        reputationId,
        warningId,
      };
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });

    await expect(
      asOwner.mutation(api.forum.moveForumPosts, {
        postIds: [seed.publicPostId],
        targetThreadId: seed.trustedThreadId,
        moderationReason: "Wrong board",
      }),
    ).resolves.toMatchObject({
      moved: 1,
      postIds: [seed.publicPostId],
      nextPostNumbers: [3],
    });

    const snapshot = await t.run(async (ctx) => {
      const [
        movedPost,
        sourceThread,
        targetThread,
        sourceCategory,
        targetCategory,
        edit,
        report,
        warning,
        reputation,
        notification,
        emailDelivery,
        relatedEvent,
      ] = await Promise.all([
        ctx.db.get(seed.publicPostId),
        ctx.db.get(seed.publicThreadId),
        ctx.db.get(seed.trustedThreadId),
        ctx.db.get(seed.publicCategoryId),
        ctx.db.get(seed.trustedCategoryId),
        ctx.db.get(related.editId),
        ctx.db.get(related.reportId),
        ctx.db.get(related.warningId),
        ctx.db.get(related.reputationId),
        ctx.db.get(related.notificationId),
        ctx.db.get(related.emailDeliveryId),
        ctx.db.get(related.relatedEventId),
      ]);
      const moveEvent = await ctx.db
        .query("forumModerationEvents")
        .withIndex("by_eventType_and_createdAt", (q) =>
          q.eq("eventType", "forum_posts_moved"),
        )
        .first();
      const subscription = await ctx.db
        .query("forumThreadSubscriptions")
        .withIndex("by_userId_and_threadId", (q) =>
          q
            .eq("userId", seed.trustedUserId)
            .eq("threadId", seed.trustedThreadId),
        )
        .unique();
      return {
        edit,
        emailDelivery,
        movedPost,
        moveEvent:
          moveEvent === null
            ? null
            : {
                ...moveEvent,
                metadata: JSON.parse(moveEvent.metadataJson),
              },
        notification,
        relatedEvent,
        report,
        reputation,
        sourceCategory,
        sourceThread,
        subscription,
        targetCategory,
        targetThread,
        warning,
      };
    });

    expect(snapshot.movedPost).toMatchObject({
      _id: seed.publicPostId,
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
      postNumber: 3,
      moderationReason: "Wrong board",
    });
    expect(snapshot.sourceThread).toMatchObject({
      replyCount: 0,
      lastPostAt: 1_800_000_000_001,
      lastPostUserId: seed.trustedUserId,
    });
    expect(snapshot.targetThread).toMatchObject({
      replyCount: 2,
      lastAssignedPostNumber: 3,
      lastPostId: seed.trustedPostId,
      lastPostAt: 1_800_000_000_004,
    });
    expect(snapshot.sourceCategory).toMatchObject({ postCount: 1 });
    expect(snapshot.targetCategory).toMatchObject({ postCount: 3 });
    expect(snapshot.edit).toMatchObject({ threadId: seed.trustedThreadId });
    expect(snapshot.report).toMatchObject({
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
    });
    expect(snapshot.warning).toMatchObject({
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
    });
    expect(snapshot.reputation).toMatchObject({
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
    });
    expect(snapshot.notification).toMatchObject({
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
    });
    expect(snapshot.emailDelivery).toMatchObject({
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
    });
    expect(snapshot.relatedEvent).toMatchObject({
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
    });
    expect(snapshot.subscription).toMatchObject({
      userId: seed.trustedUserId,
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
      status: "active",
    });
    expect(snapshot.moveEvent).toMatchObject({
      eventType: "forum_posts_moved",
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
      metadata: {
        sourceThreadId: seed.publicThreadId,
        targetThreadId: seed.trustedThreadId,
        postIds: [seed.publicPostId],
        previousPostNumbers: [2],
        nextPostNumbers: [3],
      },
    });

    const detail = await asOwner.query(api.forum.getThread, {
      categorySlug: "trusted-lab",
      threadSlug: "trusted-lunar-brief",
      pageSize: 5,
    });
    expect(detail.replies.page.map((post) => post._id)).toEqual([
      seed.trustedPostId,
      seed.publicPostId,
    ]);
    expect(detail.replies.page.map((post) => post.postNumber)).toEqual([2, 3]);
  });

  test("moderators can split selected replies into a new thread", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const related = await t.run(async (ctx) => {
      const now = 1_800_000_000_005;
      const postId = await insertPost(ctx, {
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        authorId: seed.otherTrustedUserId,
        body: "Second public reply with a clean branch of the discussion.",
        postNumber: 3,
        now,
      });
      await ctx.db.patch(seed.publicThreadId, {
        replyCount: 2,
        lastAssignedPostNumber: 3,
        lastPostId: postId,
        lastPostAt: now,
        lastPostUserId: seed.otherTrustedUserId,
        updatedAt: now,
      });
      await ctx.db.patch(seed.publicCategoryId, {
        postCount: 3,
        lastThreadId: seed.publicThreadId,
        lastPostId: postId,
        lastPostAt: now,
        updatedAt: now,
      });
      const emailDeliveryId = await ctx.db.insert(
        "forumNotificationEmailDeliveries",
        {
          recipientUserId: seed.otherTrustedUserId,
          actorUserId: seed.trustedUserId,
          threadId: seed.publicThreadId,
          categoryId: seed.publicCategoryId,
          postId: seed.publicPostId,
          type: "reply",
          status: "queued",
          toEmail: "other@example.com",
          createdAt: now + 1,
          updatedAt: now + 1,
        },
      );
      const moderationEventId = await ctx.db.insert("forumModerationEvents", {
        actorUserId: seed.ownerId,
        entityType: "forumPost",
        entityId: seed.publicPostId,
        eventType: "forum_post_moderated",
        message: "Promoted reply reviewed",
        categoryId: seed.publicCategoryId,
        threadId: seed.publicThreadId,
        postId: seed.publicPostId,
        metadataJson: "{}",
        createdAt: now + 2,
      });
      return { emailDeliveryId, extraPublicPostId: postId, moderationEventId };
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });

    const result = await asOwner.mutation(api.forum.splitForumPosts, {
      postIds: [related.extraPublicPostId, seed.publicPostId],
      targetCategoryId: seed.trustedCategoryId,
      title: "Split lunar launch logs",
      moderationReason: "New branch",
    });

    expect(result).toMatchObject({
      split: 2,
      promotedPostId: seed.publicPostId,
      postIds: [seed.publicPostId, related.extraPublicPostId],
      nextPostNumbers: [1, 2],
      sourceThread: {
        _id: seed.publicThreadId,
        replyCount: 0,
      },
      newThread: {
        title: "Split lunar launch logs",
        categoryId: seed.trustedCategoryId,
        replyCount: 1,
      },
    });

    const snapshot = await t.run(async (ctx) => {
      const [
        emailDelivery,
        moderationEvent,
        promotedPost,
        movedReply,
        sourceThread,
        newThread,
        sourceCategory,
        targetCategory,
        profile,
      ] = await Promise.all([
        ctx.db.get(related.emailDeliveryId),
        ctx.db.get(related.moderationEventId),
        ctx.db.get(seed.publicPostId),
        ctx.db.get(related.extraPublicPostId),
        ctx.db.get(seed.publicThreadId),
        ctx.db.get(result.newThread._id as Id<"forumThreads">),
        ctx.db.get(seed.publicCategoryId),
        ctx.db.get(seed.trustedCategoryId),
        ctx.db
          .query("forumUserProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", seed.trustedUserId))
          .unique(),
      ]);
      const moveEvent = await ctx.db
        .query("forumModerationEvents")
        .withIndex("by_eventType_and_createdAt", (q) =>
          q.eq("eventType", "forum_posts_moved"),
        )
        .first();
      return {
        emailDelivery,
        moderationEvent,
        moveEvent:
          moveEvent === null
            ? null
            : {
                ...moveEvent,
                metadata: JSON.parse(moveEvent.metadataJson),
              },
        movedReply,
        newThread,
        profile,
        promotedPost,
        sourceCategory,
        sourceThread,
        targetCategory,
      };
    });

    expect(snapshot.promotedPost).toMatchObject({
      _id: seed.publicPostId,
      status: "deleted",
      deletedBy: seed.ownerId,
      moderationReason: "New branch",
    });
    expect(snapshot.movedReply).toMatchObject({
      _id: related.extraPublicPostId,
      threadId: result.newThread._id,
      categoryId: seed.trustedCategoryId,
      postNumber: 2,
      moderationReason: "New branch",
    });
    expect(snapshot.emailDelivery).toMatchObject({
      threadId: result.newThread._id,
      categoryId: seed.trustedCategoryId,
    });
    expect(snapshot.emailDelivery?.postId).toBeUndefined();
    expect(snapshot.moderationEvent).toMatchObject({
      threadId: result.newThread._id,
      categoryId: seed.trustedCategoryId,
    });
    expect(snapshot.moderationEvent?.postId).toBeUndefined();
    expect(snapshot.sourceThread).toMatchObject({
      replyCount: 0,
      lastPostAt: 1_800_000_000_001,
      lastPostUserId: seed.trustedUserId,
    });
    expect(snapshot.newThread).toMatchObject({
      body: "Public reply about lunar launch logs.",
      replyCount: 1,
      lastAssignedPostNumber: 2,
      lastPostId: related.extraPublicPostId,
      lastPostAt: 1_800_000_000_005,
      lastPostUserId: seed.otherTrustedUserId,
    });
    expect(snapshot.sourceCategory).toMatchObject({ postCount: 1 });
    expect(snapshot.targetCategory).toMatchObject({
      threadCount: 2,
      postCount: 4,
    });
    expect(snapshot.profile).toMatchObject({
      userId: seed.trustedUserId,
      threadCount: 1,
      postCount: 0,
    });
    expect(snapshot.moveEvent).toMatchObject({
      eventType: "forum_posts_moved",
      threadId: result.newThread._id,
      categoryId: seed.trustedCategoryId,
      metadata: {
        operation: "split",
        sourceThreadId: seed.publicThreadId,
        targetThreadId: result.newThread._id,
        promotedPostId: seed.publicPostId,
        postIds: [seed.publicPostId, related.extraPublicPostId],
        previousPostNumbers: [2, 3],
        nextPostNumbers: [1, 2],
      },
    });

    const detail = await asOwner.query(api.forum.getThread, {
      categorySlug: "trusted-lab",
      threadSlug: result.newThread.slug,
      pageSize: 5,
    });
    expect(detail.thread.body).toBe("Public reply about lunar launch logs.");
    expect(detail.replies.page.map((post) => post._id)).toEqual([
      related.extraPublicPostId,
    ]);
    expect(detail.replies.page.map((post) => post.postNumber)).toEqual([2]);
  });

  test("splitting replies requires admin access and a valid single-source selection", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });

    await expect(
      asTrusted.mutation(api.forum.splitForumPosts, {
        postIds: [seed.publicPostId],
        targetCategoryId: seed.trustedCategoryId,
        title: "Split lunar launch logs",
      }),
    ).rejects.toThrow(/admin access/i);

    await expect(
      asOwner.mutation(api.forum.splitForumPosts, {
        postIds: [seed.publicPostId, seed.trustedPostId],
        targetCategoryId: seed.trustedCategoryId,
        title: "Split lunar launch logs",
      }),
    ).rejects.toThrow(/one source thread/);

    await t.run(async (ctx) => {
      await ctx.db.patch(seed.publicPostId, {
        status: "hidden",
        updatedAt: 1_800_000_000_600,
      });
    });
    await expect(
      asOwner.mutation(api.forum.splitForumPosts, {
        postIds: [seed.publicPostId],
        targetCategoryId: seed.trustedCategoryId,
        title: "Split lunar launch logs",
      }),
    ).rejects.toThrow(/Only active replies/);
  });

  test("moderators can merge a source thread into a target thread", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });
    const related = await t.run(async (ctx) => {
      const now = 1_800_000_000_500;
      const emailDeliveryId = await ctx.db.insert(
        "forumNotificationEmailDeliveries",
        {
          recipientUserId: seed.otherTrustedUserId,
          actorUserId: seed.trustedUserId,
          threadId: seed.publicThreadId,
          categoryId: seed.publicCategoryId,
          type: "newThread",
          status: "queued",
          toEmail: "other@example.com",
          createdAt: now,
          updatedAt: now,
        },
      );
      const moderationEventId = await ctx.db.insert("forumModerationEvents", {
        actorUserId: seed.ownerId,
        entityType: "forumThread",
        entityId: seed.publicThreadId,
        eventType: "forum_thread_moderated",
        message: "Source thread reviewed before merge",
        categoryId: seed.publicCategoryId,
        threadId: seed.publicThreadId,
        metadataJson: "{}",
        createdAt: now + 1,
      });
      return { emailDeliveryId, moderationEventId };
    });

    const result = await asOwner.mutation(api.forum.mergeForumThread, {
      sourceThreadId: seed.publicThreadId,
      targetThreadId: seed.trustedThreadId,
      moderationReason: "Combine topics",
    });

    expect(result).toMatchObject({
      merged: 2,
      sourceThread: {
        _id: seed.publicThreadId,
        status: "deleted",
        replyCount: 0,
      },
      targetThread: {
        _id: seed.trustedThreadId,
        replyCount: 3,
      },
      postIds: [result.sourceOpenerPostId, seed.publicPostId],
      nextPostNumbers: [3, 4],
    });

    const snapshot = await t.run(async (ctx) => {
      const [
        emailDelivery,
        moderationEvent,
        sourceOpenerPost,
        movedReply,
        sourceThread,
        targetThread,
        sourceCategory,
        targetCategory,
        profile,
      ] = await Promise.all([
        ctx.db.get(related.emailDeliveryId),
        ctx.db.get(related.moderationEventId),
        ctx.db.get(result.sourceOpenerPostId as Id<"forumPosts">),
        ctx.db.get(seed.publicPostId),
        ctx.db.get(seed.publicThreadId),
        ctx.db.get(seed.trustedThreadId),
        ctx.db.get(seed.publicCategoryId),
        ctx.db.get(seed.trustedCategoryId),
        ctx.db
          .query("forumUserProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", seed.trustedUserId))
          .unique(),
      ]);
      const moveEvent = await ctx.db
        .query("forumModerationEvents")
        .withIndex("by_eventType_and_createdAt", (q) =>
          q.eq("eventType", "forum_posts_moved"),
        )
        .first();
      return {
        emailDelivery,
        moderationEvent,
        moveEvent:
          moveEvent === null
            ? null
            : {
                ...moveEvent,
                metadata: JSON.parse(moveEvent.metadataJson),
              },
        movedReply,
        profile,
        sourceCategory,
        sourceOpenerPost,
        sourceThread,
        targetCategory,
        targetThread,
      };
    });

    expect(snapshot.sourceOpenerPost).toMatchObject({
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
      body: "Public members can read this lunar launch discussion.",
      postNumber: 3,
      status: "active",
    });
    expect(snapshot.emailDelivery).toMatchObject({
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
      postId: result.sourceOpenerPostId,
    });
    expect(snapshot.moderationEvent).toMatchObject({
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
      postId: result.sourceOpenerPostId,
    });
    expect(snapshot.movedReply).toMatchObject({
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
      postNumber: 4,
      moderationReason: "Combine topics",
    });
    expect(snapshot.sourceThread).toMatchObject({
      status: "deleted",
      replyCount: 0,
      deletedBy: seed.ownerId,
      moderationReason: "Combine topics",
    });
    expect(snapshot.targetThread).toMatchObject({
      replyCount: 3,
      lastAssignedPostNumber: 4,
      lastPostId: seed.trustedPostId,
      lastPostAt: 1_800_000_000_004,
    });
    expect(snapshot.sourceCategory).toMatchObject({
      threadCount: 0,
      postCount: 0,
    });
    expect(snapshot.targetCategory).toMatchObject({
      threadCount: 1,
      postCount: 4,
    });
    expect(snapshot.profile).toMatchObject({
      userId: seed.trustedUserId,
      threadCount: 0,
      postCount: 0,
    });
    expect(snapshot.moveEvent).toMatchObject({
      eventType: "forum_posts_moved",
      threadId: seed.trustedThreadId,
      categoryId: seed.trustedCategoryId,
      metadata: {
        operation: "merge",
        sourceThreadId: seed.publicThreadId,
        targetThreadId: seed.trustedThreadId,
        sourceOpenerPostId: result.sourceOpenerPostId,
        postIds: [result.sourceOpenerPostId, seed.publicPostId],
        previousPostNumbers: [1, 2],
        nextPostNumbers: [3, 4],
      },
    });

    const detail = await asOwner.query(api.forum.getThread, {
      categorySlug: "trusted-lab",
      threadSlug: "trusted-lunar-brief",
      pageSize: 5,
    });
    expect(detail.replies.page.map((post) => post._id)).toEqual([
      seed.trustedPostId,
      result.sourceOpenerPostId,
      seed.publicPostId,
    ]);
    expect(detail.replies.page.map((post) => post.postNumber)).toEqual([
      2, 3, 4,
    ]);
  });

  test("moved historical replies become unread in the destination thread", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const seed = await seedForum(t);
      const asTrusted = t.withIdentity({
        subject: seed.trustedUserId,
        name: "Trusted Author",
      });
      const asOwner = t.withIdentity({
        subject: seed.ownerId,
        name: "Owner",
      });
      const extraPublicPostId = await t.run(async (ctx) => {
        const now = 1_800_000_000_005;
        const postId = await insertPost(ctx, {
          threadId: seed.publicThreadId,
          categoryId: seed.publicCategoryId,
          authorId: seed.otherTrustedUserId,
          body: "Second public reply with a clean branch of the discussion.",
          postNumber: 3,
          now,
        });
        await ctx.db.patch(seed.publicThreadId, {
          replyCount: 2,
          lastAssignedPostNumber: 3,
          lastPostId: postId,
          lastPostAt: now,
          lastPostUserId: seed.otherTrustedUserId,
          updatedAt: now,
        });
        await ctx.db.patch(seed.publicCategoryId, {
          postCount: 3,
          lastThreadId: seed.publicThreadId,
          lastPostId: postId,
          lastPostAt: now,
          updatedAt: now,
        });
        return postId;
      });

      vi.setSystemTime(1_800_000_000_900);
      await asTrusted.mutation(api.forum.markCategoryRead, {
        categorySlug: "trusted-lab",
      });

      vi.setSystemTime(1_800_000_001_000);
      await asOwner.mutation(api.forum.moveForumPosts, {
        postIds: [extraPublicPostId, seed.publicPostId],
        targetThreadId: seed.trustedThreadId,
        moderationReason: "Wrong board",
      });

      const board = await asTrusted.query(api.forum.listThreads, {
        categorySlug: "trusted-lab",
        pageSize: 10,
      });
      const movedThread = board.threads.find(
        (thread) => thread._id === seed.trustedThreadId,
      );
      expect(movedThread).toMatchObject({
        viewerUnread: true,
        firstUnreadPostNumber: 3,
      });

      const detail = await asTrusted.query(api.forum.getThread, {
        categorySlug: "trusted-lab",
        threadSlug: "trusted-lunar-brief",
        pageSize: 10,
      });
      expect(detail.thread).toMatchObject({
        viewerUnread: true,
        firstUnreadPostNumber: 3,
      });

      await asTrusted.mutation(api.forum.markThreadRead, {
        threadId: seed.trustedThreadId,
        lastReadPostNumber: 3,
      });
      await expect(
        asTrusted.query(api.forum.getThread, {
          categorySlug: "trusted-lab",
          threadSlug: "trusted-lunar-brief",
          pageSize: 10,
        }),
      ).resolves.toMatchObject({
        thread: {
          viewerUnread: true,
          firstUnreadPostNumber: 4,
        },
      });

      await asTrusted.mutation(api.forum.markThreadRead, {
        threadId: seed.trustedThreadId,
        lastReadPostNumber: 4,
      });
      await expect(
        asTrusted.query(api.forum.getThread, {
          categorySlug: "trusted-lab",
          threadSlug: "trusted-lunar-brief",
          pageSize: 10,
        }),
      ).resolves.toMatchObject({
        thread: {
          viewerHasRead: true,
          viewerUnread: false,
        },
      });

      const stored = await t.run(async (ctx) => {
        const [firstMovedPost, secondMovedPost, targetThread] =
          await Promise.all([
            ctx.db.get(seed.publicPostId),
            ctx.db.get(extraPublicPostId),
            ctx.db.get(seed.trustedThreadId),
          ]);
        return { firstMovedPost, secondMovedPost, targetThread };
      });
      expect(stored.firstMovedPost).toMatchObject({
        moderationMovedAt: 1_800_000_001_000,
      });
      expect(stored.secondMovedPost).toMatchObject({
        moderationMovedAt: 1_800_000_001_000,
      });
      expect(stored.targetThread).toMatchObject({
        moderationActivityAt: 1_800_000_001_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("whole-thread moves become unread in a previously read destination board", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const seed = await seedForum(t);
      const asTrusted = t.withIdentity({
        subject: seed.trustedUserId,
        name: "Trusted Author",
      });
      const asOwner = t.withIdentity({
        subject: seed.ownerId,
        name: "Owner",
      });
      const related = await t.run(async (ctx) => {
        const now = 1_800_000_000_700;
        const emailDeliveryId = await ctx.db.insert(
          "forumNotificationEmailDeliveries",
          {
            recipientUserId: seed.otherTrustedUserId,
            actorUserId: seed.trustedUserId,
            threadId: seed.publicThreadId,
            categoryId: seed.publicCategoryId,
            type: "newThread",
            status: "queued",
            toEmail: "other@example.com",
            createdAt: now,
            updatedAt: now,
          },
        );
        const moderationEventId = await ctx.db.insert("forumModerationEvents", {
          actorUserId: seed.ownerId,
          entityType: "forumThread",
          entityId: seed.publicThreadId,
          eventType: "forum_thread_moderated",
          message: "Thread reviewed before move",
          categoryId: seed.publicCategoryId,
          threadId: seed.publicThreadId,
          metadataJson: "{}",
          createdAt: now + 1,
        });
        return { emailDeliveryId, moderationEventId };
      });

      vi.setSystemTime(1_800_000_000_900);
      await asTrusted.mutation(api.forum.markCategoryRead, {
        categorySlug: "trusted-lab",
      });

      vi.setSystemTime(1_800_000_001_000);
      await asOwner.mutation(api.forum.moveForumThread, {
        threadId: seed.publicThreadId,
        targetCategoryId: seed.trustedCategoryId,
        moderationReason: "Better in the lab",
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const board = await asTrusted.query(api.forum.listThreads, {
        categorySlug: "trusted-lab",
        pageSize: 10,
      });
      const movedThread = board.threads.find(
        (thread) => thread._id === seed.publicThreadId,
      );
      expect(movedThread).toMatchObject({
        viewerUnread: true,
        firstUnreadPostNumber: 1,
      });

      await asTrusted.mutation(api.forum.markThreadRead, {
        threadId: seed.publicThreadId,
        lastReadPostNumber: 1,
      });
      await expect(
        asTrusted.query(api.forum.getThread, {
          categorySlug: "trusted-lab",
          threadSlug: "public-lunar-brief",
          pageSize: 10,
        }),
      ).resolves.toMatchObject({
        thread: {
          viewerUnread: true,
          firstUnreadPostNumber: 2,
        },
      });

      await asTrusted.mutation(api.forum.markThreadRead, {
        threadId: seed.publicThreadId,
        lastReadPostNumber: 2,
      });
      await expect(
        asTrusted.query(api.forum.getThread, {
          categorySlug: "trusted-lab",
          threadSlug: "public-lunar-brief",
          pageSize: 10,
        }),
      ).resolves.toMatchObject({
        thread: {
          viewerHasRead: true,
          viewerUnread: false,
        },
      });

      const stored = await t.run(async (ctx) => {
        const [emailDelivery, moderationEvent, movedReply, movedThreadRecord] =
          await Promise.all([
            ctx.db.get(related.emailDeliveryId),
            ctx.db.get(related.moderationEventId),
            ctx.db.get(seed.publicPostId),
            ctx.db.get(seed.publicThreadId),
          ]);
        return {
          emailDelivery,
          moderationEvent,
          movedReply,
          movedThreadRecord,
        };
      });
      expect(stored.emailDelivery).toMatchObject({
        categoryId: seed.trustedCategoryId,
        threadId: seed.publicThreadId,
      });
      expect(stored.moderationEvent).toMatchObject({
        categoryId: seed.trustedCategoryId,
        threadId: seed.publicThreadId,
      });
      expect(stored.movedReply).toMatchObject({
        categoryId: seed.trustedCategoryId,
        moderationMovedAt: 1_800_000_001_000,
      });
      expect(stored.movedThreadRecord).toMatchObject({
        categoryId: seed.trustedCategoryId,
        moderationActivityAt: 1_800_000_001_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("split historical replies become unread as a new destination thread", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const seed = await seedForum(t);
      const asTrusted = t.withIdentity({
        subject: seed.trustedUserId,
        name: "Trusted Author",
      });
      const asOwner = t.withIdentity({
        subject: seed.ownerId,
        name: "Owner",
      });
      const extraPublicPostId = await t.run(async (ctx) => {
        const now = 1_800_000_000_005;
        const postId = await insertPost(ctx, {
          threadId: seed.publicThreadId,
          categoryId: seed.publicCategoryId,
          authorId: seed.otherTrustedUserId,
          body: "Second public reply with a clean branch of the discussion.",
          postNumber: 3,
          now,
        });
        await ctx.db.patch(seed.publicThreadId, {
          replyCount: 2,
          lastAssignedPostNumber: 3,
          lastPostId: postId,
          lastPostAt: now,
          lastPostUserId: seed.otherTrustedUserId,
          updatedAt: now,
        });
        await ctx.db.patch(seed.publicCategoryId, {
          postCount: 3,
          lastThreadId: seed.publicThreadId,
          lastPostId: postId,
          lastPostAt: now,
          updatedAt: now,
        });
        return postId;
      });

      vi.setSystemTime(1_800_000_000_900);
      await asTrusted.mutation(api.forum.markCategoryRead, {
        categorySlug: "trusted-lab",
      });

      vi.setSystemTime(1_800_000_001_000);
      const result = await asOwner.mutation(api.forum.splitForumPosts, {
        postIds: [extraPublicPostId, seed.publicPostId],
        targetCategoryId: seed.trustedCategoryId,
        title: "Split lunar launch logs",
        moderationReason: "New branch",
      });

      const board = await asTrusted.query(api.forum.listThreads, {
        categorySlug: "trusted-lab",
        pageSize: 10,
      });
      const newThread = board.threads.find(
        (thread) => thread._id === result.newThread._id,
      );
      expect(newThread).toMatchObject({
        viewerUnread: true,
        firstUnreadPostNumber: 1,
      });

      await expect(
        asTrusted.query(api.forum.getThread, {
          categorySlug: "trusted-lab",
          threadSlug: result.newThread.slug,
          pageSize: 10,
        }),
      ).resolves.toMatchObject({
        thread: {
          viewerUnread: true,
          firstUnreadPostNumber: 1,
        },
      });

      await asTrusted.mutation(api.forum.markThreadRead, {
        threadId: result.newThread._id as Id<"forumThreads">,
        lastReadPostNumber: 1,
      });
      await expect(
        asTrusted.query(api.forum.getThread, {
          categorySlug: "trusted-lab",
          threadSlug: result.newThread.slug,
          pageSize: 10,
        }),
      ).resolves.toMatchObject({
        thread: {
          viewerUnread: true,
          firstUnreadPostNumber: 2,
        },
      });

      await asTrusted.mutation(api.forum.markThreadRead, {
        threadId: result.newThread._id as Id<"forumThreads">,
        lastReadPostNumber: 2,
      });
      await expect(
        asTrusted.query(api.forum.getThread, {
          categorySlug: "trusted-lab",
          threadSlug: result.newThread.slug,
          pageSize: 10,
        }),
      ).resolves.toMatchObject({
        thread: {
          viewerHasRead: true,
          viewerUnread: false,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("merged historical threads become unread at the appended source opener", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const seed = await seedForum(t);
      const asTrusted = t.withIdentity({
        subject: seed.trustedUserId,
        name: "Trusted Author",
      });
      const asOwner = t.withIdentity({
        subject: seed.ownerId,
        name: "Owner",
      });

      vi.setSystemTime(1_800_000_000_900);
      await asTrusted.mutation(api.forum.markCategoryRead, {
        categorySlug: "trusted-lab",
      });

      vi.setSystemTime(1_800_000_001_000);
      await asOwner.mutation(api.forum.mergeForumThread, {
        sourceThreadId: seed.publicThreadId,
        targetThreadId: seed.trustedThreadId,
        moderationReason: "Combine topics",
      });

      const detail = await asTrusted.query(api.forum.getThread, {
        categorySlug: "trusted-lab",
        threadSlug: "trusted-lunar-brief",
        pageSize: 10,
      });
      expect(detail.thread).toMatchObject({
        viewerUnread: true,
        firstUnreadPostNumber: 3,
      });

      await asTrusted.mutation(api.forum.markThreadRead, {
        threadId: seed.trustedThreadId,
        lastReadPostNumber: 3,
      });
      await expect(
        asTrusted.query(api.forum.getThread, {
          categorySlug: "trusted-lab",
          threadSlug: "trusted-lunar-brief",
          pageSize: 10,
        }),
      ).resolves.toMatchObject({
        thread: {
          viewerUnread: true,
          firstUnreadPostNumber: 4,
        },
      });

      const movedPostNumbers = detail.replies.page
        .filter((post) => post.threadId === seed.trustedThreadId)
        .map((post) => post.postNumber);
      expect(movedPostNumbers).toEqual([2, 3, 4]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("merging threads rejects non-admins, same-thread targets, and source polls", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });

    await expect(
      asTrusted.mutation(api.forum.mergeForumThread, {
        sourceThreadId: seed.publicThreadId,
        targetThreadId: seed.trustedThreadId,
      }),
    ).rejects.toThrow(/admin access/i);

    await expect(
      asOwner.mutation(api.forum.mergeForumThread, {
        sourceThreadId: seed.publicThreadId,
        targetThreadId: seed.publicThreadId,
      }),
    ).rejects.toThrow(/different target thread/);

    await t.run(async (ctx) => {
      await insertPoll(ctx, {
        threadId: seed.publicThreadId,
        categoryId: seed.publicCategoryId,
        question: "Merge this poll?",
        options: ["Yes", "No"],
        now: 1_800_000_000_700,
      });
    });
    await expect(
      asOwner.mutation(api.forum.mergeForumThread, {
        sourceThreadId: seed.publicThreadId,
        targetThreadId: seed.trustedThreadId,
      }),
    ).rejects.toThrow(/polls need manual handling/);
  });

  test("moving replies requires admin access and active selections", async () => {
    const t = setup();
    const seed = await seedForum(t);
    const asTrusted = t.withIdentity({
      subject: seed.trustedUserId,
      name: "Trusted Author",
    });
    const asOwner = t.withIdentity({
      subject: seed.ownerId,
      name: "Owner",
    });

    await expect(
      asTrusted.mutation(api.forum.moveForumPosts, {
        postIds: [seed.publicPostId],
        targetThreadId: seed.trustedThreadId,
      }),
    ).rejects.toThrow(/admin access/i);

    await t.run(async (ctx) => {
      await ctx.db.patch(seed.publicPostId, {
        status: "hidden",
        updatedAt: 1_800_000_000_600,
      });
    });
    await expect(
      asOwner.mutation(api.forum.moveForumPosts, {
        postIds: [seed.publicPostId],
        targetThreadId: seed.trustedThreadId,
      }),
    ).rejects.toThrow(/Only active replies/);
  });
});

type SeedCategory = {
  slug: string;
  name: string;
  viewAccess: "public" | "trusted";
  position: number;
  now: number;
};

async function insertCategory(
  ctx: Parameters<Parameters<TestBackend["run"]>[0]>[0],
  category: SeedCategory,
) {
  return await ctx.db.insert("forumCategories", {
    slug: category.slug,
    name: category.name,
    description: `${category.name} description`,
    kind: "board",
    status: "active",
    viewAccess: category.viewAccess,
    threadAccess: "trusted",
    replyAccess: "trusted",
    pollAccess: "trusted",
    position: category.position,
    threadCount: 1,
    postCount: 2,
    createdAt: category.now,
    updatedAt: category.now,
  });
}

type SeedThread = {
  categoryId: Id<"forumCategories">;
  categorySlug: string;
  prefix?: {
    _id: Id<"forumThreadPrefixes">;
    slug: string;
    label: string;
    color?: string;
  };
  slug: string;
  title: string;
  body: string;
  authorId: Id<"users">;
  now: number;
};

async function insertThread(
  ctx: Parameters<Parameters<TestBackend["run"]>[0]>[0],
  thread: SeedThread,
) {
  return await ctx.db.insert("forumThreads", {
    categoryId: thread.categoryId,
    categorySlug: thread.categorySlug,
    prefixId: thread.prefix?._id,
    prefixSlug: thread.prefix?.slug,
    prefixLabel: thread.prefix?.label,
    prefixColor: thread.prefix?.color,
    slug: thread.slug,
    title: thread.title,
    body: thread.body,
    authorId: thread.authorId,
    status: "active",
    pinned: false,
    replyCount: 1,
    lastAssignedPostNumber: 2,
    viewCount: 0,
    lastPostAt: thread.now,
    lastPostUserId: thread.authorId,
    searchText: [
      thread.title,
      thread.body,
      thread.categorySlug,
      "Trusted Author",
    ].join("\n"),
    createdAt: thread.now,
    updatedAt: thread.now,
  });
}

type SeedPost = {
  threadId: Id<"forumThreads">;
  categoryId: Id<"forumCategories">;
  authorId: Id<"users">;
  body: string;
  postNumber: number;
  now: number;
};

async function insertPost(
  ctx: Parameters<Parameters<TestBackend["run"]>[0]>[0],
  post: SeedPost,
) {
  return await ctx.db.insert("forumPosts", {
    threadId: post.threadId,
    categoryId: post.categoryId,
    authorId: post.authorId,
    body: post.body,
    postNumber: post.postNumber,
    status: "active",
    createdAt: post.now,
    updatedAt: post.now,
  });
}

type SeedStoredForumAttachment = {
  threadId: Id<"forumThreads">;
  postId?: Id<"forumPosts">;
  categoryId: Id<"forumCategories">;
  authorId: Id<"users">;
  filename: string;
  body: string;
  now: number;
};

async function insertStoredForumAttachment(
  ctx: Parameters<Parameters<TestBackend["run"]>[0]>[0],
  attachment: SeedStoredForumAttachment,
) {
  const blob = new Blob([attachment.body], { type: "text/plain" });
  const storageId = await ctx.storage.store(blob);
  return await ctx.db.insert("forumAttachments", {
    threadId: attachment.threadId,
    postId: attachment.postId,
    categoryId: attachment.categoryId,
    authorId: attachment.authorId,
    storageId,
    filename: attachment.filename,
    contentType: "text/plain",
    size: blob.size,
    status: "active",
    createdAt: attachment.now,
    updatedAt: attachment.now,
  });
}

type SeedPoll = {
  threadId: Id<"forumThreads">;
  categoryId: Id<"forumCategories">;
  question: string;
  options: string[];
  now: number;
};

async function insertPoll(
  ctx: Parameters<Parameters<TestBackend["run"]>[0]>[0],
  poll: SeedPoll,
) {
  const pollId = await ctx.db.insert("forumPolls", {
    threadId: poll.threadId,
    categoryId: poll.categoryId,
    question: poll.question,
    status: "open",
    optionCount: poll.options.length,
    totalVotes: 0,
    createdAt: poll.now,
    updatedAt: poll.now,
  });
  for (const [position, label] of poll.options.entries()) {
    await ctx.db.insert("forumPollOptions", {
      pollId,
      threadId: poll.threadId,
      label,
      position,
      voteCount: 0,
      createdAt: poll.now,
      updatedAt: poll.now,
    });
  }
  const thread = await ctx.db.get(poll.threadId);
  const category = await ctx.db.get(poll.categoryId);
  if (thread !== null && category !== null) {
    await ctx.db.patch(thread._id, {
      searchText: [
        thread.title,
        [thread.body, poll.question, ...poll.options].join("\n"),
        category.name,
        category.slug,
        "Trusted Author",
      ].join("\n"),
      updatedAt: poll.now,
    });
  }
  return pollId;
}
