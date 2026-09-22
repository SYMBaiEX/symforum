import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  parseEditorialNewsletterPayload,
  type EditorialNewsletterPayload,
} from "./newsletterPayload";
import { syncNewsletterIssueUniversalSearchProjection } from "./universalSearchProjection";

const LIST_MIGRATION_KEY = "newsletter-digests-v1";
const ROUTING_MIGRATION_KEY = "newsletter-digests-v2-routing";
const backfillNewsletterIssueDigestsRef = makeFunctionReference<
  "mutation",
  { cursor?: string; limit?: number },
  { processed: number; cursor: string | null; done: boolean }
>("newsletterDigests:backfillNewsletterIssueDigests");

export type NewsletterIssueRouting = {
  version: 1;
  siteUrl: string;
  newsUrl: string;
  archiveUrl: string;
  stories: Array<{
    hnItemId: number;
    sourceUrl: string;
    discussionUrl: string;
  }>;
};

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
    routingJson:
      payload === null
        ? undefined
        : JSON.stringify(newsletterIssueRouting(payload)),
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
  await syncNewsletterIssueUniversalSearchProjection(ctx, issue);
}

export async function listPublicNewsletterIssueDigests(
  ctx: QueryCtx,
  limit: number,
) {
  const routingMigration = await ctx.db
    .query("optimizationMigrations")
    .withIndex("by_key", (q) => q.eq("key", ROUTING_MIGRATION_KEY))
    .unique();
  const listMigration =
    routingMigration?.status === "completed"
      ? routingMigration
      : await ctx.db
          .query("optimizationMigrations")
          .withIndex("by_key", (q) => q.eq("key", LIST_MIGRATION_KEY))
          .unique();
  if (listMigration?.status === "completed") {
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
  returns: v.object({
    processed: v.number(),
    cursor: v.union(v.string(), v.null()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("optimizationMigrations")
      .withIndex("by_key", (q) => q.eq("key", ROUTING_MIGRATION_KEY))
      .unique();
    if (state?.status === "completed") {
      return { processed: 0, cursor: null, done: true };
    }
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 200));
    const page = await ctx.db.query("newsletterIssues").paginate({
      // Persisted progress is authoritative. A delayed duplicate continuation
      // must never rewind a newer cursor supplied by the migration state.
      cursor: state?.cursor ?? args.cursor ?? null,
      numItems: limit,
    });
    for (const issue of page.page) {
      await upsertNewsletterIssueDigest(ctx, issue);
    }
    const now = Date.now();
    const processed = (state?.processed ?? 0) + page.page.length;
    const fields = {
      key: ROUTING_MIGRATION_KEY,
      status: page.isDone ? ("completed" as const) : ("running" as const),
      processed,
      cursor: page.isDone ? undefined : page.continueCursor,
      scheduledAt: page.isDone ? undefined : now,
      updatedAt: now,
      ...(page.isDone ? { completedAt: now } : {}),
    };
    if (state === null) {
      await ctx.db.insert("optimizationMigrations", fields);
    } else {
      await ctx.db.patch("optimizationMigrations", state._id, fields);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, backfillNewsletterIssueDigestsRef, {
        cursor: page.continueCursor,
        limit,
      });
    }
    return {
      processed: page.page.length,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

export function parseNewsletterIssueRouting(
  value: string | undefined,
): NewsletterIssueRouting | null {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    if (
      !isHttpUrl(parsed.siteUrl) ||
      !isHttpUrl(parsed.newsUrl) ||
      !isHttpUrl(parsed.archiveUrl) ||
      !Array.isArray(parsed.stories)
    ) {
      return null;
    }
    const stories = parsed.stories.map((story) => {
      if (
        !isRecord(story) ||
        !Number.isSafeInteger(story.hnItemId) ||
        (story.hnItemId as number) <= 0 ||
        !isHttpUrl(story.sourceUrl) ||
        !isHttpUrl(story.discussionUrl)
      ) {
        return null;
      }
      return {
        hnItemId: story.hnItemId as number,
        sourceUrl: story.sourceUrl,
        discussionUrl: story.discussionUrl,
      };
    });
    if (stories.some((story) => story === null)) return null;
    return {
      version: 1,
      siteUrl: parsed.siteUrl,
      newsUrl: parsed.newsUrl,
      archiveUrl: parsed.archiveUrl,
      stories: stories as NewsletterIssueRouting["stories"],
    };
  } catch {
    return null;
  }
}

function newsletterIssueRouting(
  payload: EditorialNewsletterPayload,
): NewsletterIssueRouting {
  return {
    version: 1,
    siteUrl: payload.siteUrl,
    newsUrl: payload.newsUrl,
    archiveUrl: payload.archiveUrl,
    stories: payload.stories.map((story) => ({
      hnItemId: story.hnItemId,
      sourceUrl: story.sourceUrl,
      discussionUrl: story.discussionUrl,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

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
