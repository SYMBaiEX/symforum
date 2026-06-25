import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Id as ConvexId } from "./_generated/dataModel";
import {
  newsletterIssueInputValidator,
  normalizeEmail,
  normalizeIssueInput,
} from "./newsletterModel";
import { normalizePostInput, postInputValidator } from "./postModel";

const entityTypeValidator = v.union(v.literal("post"), v.literal("hnStory"));

const sendIssueTestRef = makeFunctionReference<
  "action",
  { issueId: ConvexId<"newsletterIssues">; to: string },
  null
>("newsletterEmails:sendNewsletterIssueTest");

const sendIssueRef = makeFunctionReference<
  "action",
  { issueId: ConvexId<"newsletterIssues"> },
  null
>("newsletterEmails:sendNewsletterIssue");

async function authorize(ctx: MutationCtx, tokenHash: string) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
    throwUnauthorized();
  }

  const key = await ctx.db
    .query("apiKeys")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();

  if (key === null || key.revokedAt !== undefined) {
    throwUnauthorized();
  }

  await ctx.db.patch(key._id, { lastUsedAt: Date.now() });
  return key;
}

function throwUnauthorized(): never {
  throw new ConvexError({ code: "UNAUTHORIZED" });
}

async function authorName(ctx: MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return user?.username ?? user?.name ?? "SYM-UNKNOWN";
}

export const listPosts = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    return await ctx.db
      .query("posts")
      .withIndex("by_publishedAt")
      .order("desc")
      .take(100);
  },
});

export const getPost = mutation({
  args: { tokenHash: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    return await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

export const upsertPost = mutation({
  args: { tokenHash: v.string(), post: postInputValidator },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    const post = normalizePostInput(args.post);
    const existing = await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", post.slug))
      .unique();

    if (existing === null) {
      const id = await ctx.db.insert("posts", post);
      return await ctx.db.get(id);
    }

    await ctx.db.patch(existing._id, post);
    return await ctx.db.get(existing._id);
  },
});

export const deletePost = mutation({
  args: { tokenHash: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    const existing = await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing === null) {
      return { deleted: false };
    }
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});

// Image upload (Convex file storage). The admin route generates an upload URL,
// POSTs the bytes to it, then resolves the public URL from the storage id.
export const generateUploadUrl = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    return await ctx.storage.generateUploadUrl();
  },
});

export const resolveStorageUrl = mutation({
  args: { tokenHash: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    return await ctx.storage.getUrl(args.storageId);
  },
});

export const listComments = mutation({
  args: {
    tokenHash: v.string(),
    entityType: v.optional(entityTypeValidator),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    const comments =
      args.entityType && args.entityId
        ? await ctx.db
            .query("comments")
            .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
              q
                .eq("entityType", args.entityType!)
                .eq("entityId", args.entityId!),
            )
            .order("desc")
            .take(100)
        : await ctx.db
            .query("comments")
            .withIndex("by_createdAt")
            .order("desc")
            .take(100);

    return await Promise.all(
      comments.map(async (comment) => ({
        ...comment,
        author: await authorName(ctx, comment.userId),
      })),
    );
  },
});

export const deleteComment = mutation({
  args: { tokenHash: v.string(), commentId: v.id("comments") },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    await ctx.db.delete(args.commentId);
    return { deleted: true };
  },
});

export const listInteractions = mutation({
  args: {
    tokenHash: v.string(),
    entityType: v.optional(entityTypeValidator),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    const interactions =
      args.entityType && args.entityId
        ? await ctx.db
            .query("interactions")
            .withIndex("by_entityType_and_entityId", (q) =>
              q
                .eq("entityType", args.entityType!)
                .eq("entityId", args.entityId!),
            )
            .take(100)
        : await ctx.db
            .query("interactions")
            .withIndex("by_updatedAt")
            .order("desc")
            .take(100);

    return await Promise.all(
      interactions.map(async (interaction) => ({
        ...interaction,
        author: await authorName(ctx, interaction.userId),
      })),
    );
  },
});

export const deleteInteraction = mutation({
  args: { tokenHash: v.string(), interactionId: v.id("interactions") },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    await ctx.db.delete(args.interactionId);
    return { deleted: true };
  },
});

export const listNewsletterSubscribers = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    return await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_createdAt")
      .order("desc")
      .take(200);
  },
});

export const listNewsletterIssues = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    return await ctx.db
      .query("newsletterIssues")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(100);
  },
});

export const getNewsletterIssue = mutation({
  args: { tokenHash: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    return await newsletterIssueBySlug(ctx, args.slug);
  },
});

export const upsertNewsletterIssue = mutation({
  args: { tokenHash: v.string(), issue: newsletterIssueInputValidator },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    const issue = normalizeIssueInput(args.issue);
    const existing = await ctx.db
      .query("newsletterIssues")
      .withIndex("by_slug", (q) => q.eq("slug", issue.slug))
      .unique();
    const now = Date.now();

    if (existing === null) {
      const id = await ctx.db.insert("newsletterIssues", {
        ...issue,
        status: issue.status ?? "draft",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.get(id);
    }

    await ctx.db.patch(existing._id, { ...issue, updatedAt: now });
    return await ctx.db.get(existing._id);
  },
});

export const sendNewsletterIssueTest = mutation({
  args: {
    tokenHash: v.string(),
    slug: v.string(),
    to: v.string(),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    const issue = await newsletterIssueBySlug(ctx, args.slug);
    if (issue === null) {
      throw new ConvexError({ code: "NOT_FOUND" });
    }
    await ctx.scheduler.runAfter(0, sendIssueTestRef, {
      issueId: issue._id,
      to: normalizeEmail(args.to),
    });
    return { queued: true };
  },
});

export const scheduleNewsletterIssue = mutation({
  args: {
    tokenHash: v.string(),
    slug: v.string(),
    scheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    const issue = await newsletterIssueBySlug(ctx, args.slug);
    if (issue === null) {
      throw new ConvexError({ code: "NOT_FOUND" });
    }
    if (issue.status === "sent") {
      throw new ConvexError({ code: "ALREADY_SENT" });
    }
    await ctx.db.patch(issue._id, {
      status: "scheduled",
      scheduledAt: args.scheduledAt,
      errorMessage: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(Math.max(0, args.scheduledAt - Date.now()), sendIssueRef, {
      issueId: issue._id,
    });
    return { scheduled: true };
  },
});

export const sendNewsletterIssueNow = mutation({
  args: { tokenHash: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    const issue = await newsletterIssueBySlug(ctx, args.slug);
    if (issue === null) {
      throw new ConvexError({ code: "NOT_FOUND" });
    }
    if (issue.status === "sent") {
      throw new ConvexError({ code: "ALREADY_SENT" });
    }
    await ctx.db.patch(issue._id, {
      status: "scheduled",
      scheduledAt: Date.now(),
      errorMessage: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, sendIssueRef, { issueId: issue._id });
    return { queued: true };
  },
});

async function newsletterIssueBySlug(ctx: MutationCtx, slug: string) {
  const clean = normalizeIssueInput({
    slug,
    subject: slug,
    previewText: slug,
    body: slug,
  }).slug;
  return await ctx.db
    .query("newsletterIssues")
    .withIndex("by_slug", (q) => q.eq("slug", clean))
    .unique();
}
