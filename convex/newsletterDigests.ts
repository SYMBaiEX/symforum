import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { parseEditorialNewsletterPayload } from "./newsletterPayload";

const MIGRATION_KEY = "newsletter-digests-v1";

export async function upsertNewsletterIssueDigest(
  ctx: MutationCtx,
  issue: Doc<"newsletterIssues">,
) {
  const payload = parseEditorialNewsletterPayload(issue.body);
  const fields = {
    issueId: issue._id,
    issueCreatedAt: issue._creationTime,
    slug: issue.slug,
    subject: issue.subject,
    previewText: issue.previewText,
    headline: payload?.headline ?? issue.subject,
    dek: payload?.dek ?? issue.previewText,
    edition: issue.edition,
    qualityScore: issue.qualityScore ?? payload?.quality.score,
    sourceCount: payload?.stories.length ?? 0,
    status: issue.status,
    forumCategorySlug: issue.forumCategorySlug,
    forumThreadSlug: issue.forumThreadSlug,
    sentAt: issue.sentAt,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
  const existing = await ctx.db
    .query("newsletterIssueDigests")
    .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
    .unique();
  if (existing === null) {
    await ctx.db.insert("newsletterIssueDigests", fields);
  } else {
    await ctx.db.patch("newsletterIssueDigests", existing._id, fields);
  }
}

export async function listPublicNewsletterIssueDigests(
  ctx: QueryCtx,
  limit: number,
) {
  const migration = await ctx.db
    .query("optimizationMigrations")
    .withIndex("by_key", (q) => q.eq("key", MIGRATION_KEY))
    .unique();
  if (migration?.status === "completed") {
    const digests = await ctx.db
      .query("newsletterIssueDigests")
      .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "sent"))
      .order("desc")
      .take(limit);
    return digests.map(publicDigest);
  }
  const issues = await ctx.db
    .query("newsletterIssues")
    .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "sent"))
    .order("desc")
    .take(limit);
  return issues.map((issue) => {
    const payload = parseEditorialNewsletterPayload(issue.body);
    return {
      _id: issue._id,
      _creationTime: issue._creationTime,
      slug: issue.slug,
      subject: issue.subject,
      previewText: issue.previewText,
      headline: payload?.headline ?? issue.subject,
      dek: payload?.dek ?? issue.previewText,
      edition: issue.edition,
      editorialVersion: issue.editorialVersion,
      qualityScore: issue.qualityScore ?? payload?.quality.score,
      sourceCount: payload?.stories.length ?? 0,
      forumCategorySlug: issue.forumCategorySlug,
      forumThreadSlug: issue.forumThreadSlug,
      sentAt: issue.sentAt,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
  });
}

export const backfillNewsletterIssueDigests = internalMutation({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("optimizationMigrations")
      .withIndex("by_key", (q) => q.eq("key", MIGRATION_KEY))
      .unique();
    if (state?.status === "completed") {
      return { processed: 0, cursor: null, done: true };
    }
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 200));
    const page = await ctx.db.query("newsletterIssues").paginate({
      cursor: args.cursor ?? null,
      numItems: limit,
    });
    for (const issue of page.page) {
      await upsertNewsletterIssueDigest(ctx, issue);
    }
    const now = Date.now();
    const processed = (state?.processed ?? 0) + page.page.length;
    const fields = {
      key: MIGRATION_KEY,
      status: page.isDone ? ("completed" as const) : ("running" as const),
      processed,
      updatedAt: now,
      ...(page.isDone ? { completedAt: now } : {}),
    };
    if (state === null) {
      await ctx.db.insert("optimizationMigrations", fields);
    } else {
      await ctx.db.patch("optimizationMigrations", state._id, fields);
    }
    return {
      processed: page.page.length,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

function publicDigest(digest: Doc<"newsletterIssueDigests">) {
  return {
    _id: digest.issueId,
    _creationTime: digest.issueCreatedAt,
    slug: digest.slug,
    subject: digest.subject,
    previewText: digest.previewText,
    headline: digest.headline,
    dek: digest.dek,
    edition: digest.edition,
    qualityScore: digest.qualityScore,
    sourceCount: digest.sourceCount,
    forumCategorySlug: digest.forumCategorySlug,
    forumThreadSlug: digest.forumThreadSlug,
    sentAt: digest.sentAt,
    createdAt: digest.createdAt,
    updatedAt: digest.updatedAt,
  };
}
