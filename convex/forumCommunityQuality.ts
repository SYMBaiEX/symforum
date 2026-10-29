
import { FORUM_SITE_URL } from "../lib/site-urls";
import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery, type QueryCtx } from "./_generated/server";
import { getFirstPartyAuthUserId } from "./authz";
import { sha256Base64Url } from "./agentIdentityCrypto";
import { isForumDiscoveryBoard } from "../lib/forum-experience";
import {
  COMMUNITY_OUTCOME_COVERAGE_NOTES,
  communityActorKind,
  deriveForumCommunityOutcomes,
  type CommunityThreadObservation,
} from "../lib/forum-community-quality";
import {
  assessForumContentFit,
  validateForumContentCompleteness,
} from "../lib/forum-content-quality";

const MAX_SCAN = 300;
const MAX_THREADS = 50;
const MAX_REPLIES = 20;
const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const CANDIDATE_READ_BYTES = 2 * 1024 * 1024;
const REPLY_READ_RESERVE = 4 * 1024 * 1024;
const snapshotArgs = {
  startAt: v.number(),
  endAt: v.number(),
  limit: v.optional(v.number()),
  replyLimit: v.optional(v.number()),
};
type SnapshotArgs = {
  startAt: number;
  endAt: number;
  limit?: number;
  replyLimit?: number;
};

const actorKindValidator = v.union(
  v.literal("human"),
  v.literal("assisted"),
  v.literal("agent"),
  v.literal("unknown"),
);
const actorCountsValidator = v.object({
  human: v.number(),
  assisted: v.number(),
  agent: v.number(),
  unknown: v.number(),
});
const threadKindValidator = v.union(
  v.literal("discussion"),
  v.literal("question"),
  v.literal("link"),
  v.literal("showcase"),
);
const windowValidator = v.object({ startAt: v.number(), endAt: v.number() });
const communitySnapshotValidator = v.object({
  window: windowValidator.extend({ selection: v.literal("lastPostAt") }),
  limits: v.object({
    threadLimit: v.number(),
    replyLimit: v.number(),
    scanLimit: v.number(),
  }),
  coverage: v.object({
    examinedThreads: v.number(),
    selectedThreads: v.number(),
    measuredThreads: v.number(),
    unmeasuredSelectedThreads: v.number(),
    scanLimited: v.boolean(),
    candidateReadBytesLimited: v.boolean(),
    replyReadBudgetLimited: v.boolean(),
    threadLimitReached: v.boolean(),
    excludedExaminedThreads: v.number(),
    notes: v.array(v.string()),
  }),
  outcomes: v.object({
    sampledThreadCount: v.number(),
    sampledReplyCount: v.number(),
    threadsByActor: actorCountsValidator,
    repliesByActor: actorCountsValidator,
    repliesOnAgentThreads: actorCountsValidator,
    humanQuestions: v.object({
      unassisted: v.number(),
      assisted: v.number(),
      unanswered: v.number(),
      resolved: v.number(),
    }),
    threadsWithHumanProfileParticipation: v.number(),
    agentThreadsWithHumanProfileReplies: v.number(),
    agentAuthorFollowUpThreads: v.number(),
    publicationFollowUpThreads: v.number(),
    threadsWithLimitedReplySamples: v.number(),
    saves: v.null(),
  }),
  threads: v.array(
    v.object({
      threadId: v.id("forumThreads"),
      title: v.string(),
      url: v.string(),
      createdAt: v.number(),
      lastPostAt: v.number(),
      actorKind: actorKindValidator,
      kind: threadKindValidator,
      publishedReplyCount: v.number(),
      sampledReplyCount: v.number(),
      repliesLimited: v.boolean(),
      acceptedAnswerValid: v.boolean(),
      publicationFollowUpValid: v.boolean(),
    }),
  ),
});
type ForumCommunitySnapshot = Infer<typeof communitySnapshotValidator>;

const contentReviewQueueValidator = v.object({
  window: windowValidator,
  checkedInternalAgentThreads: v.number(),
  scanLimited: v.boolean(),
  candidateReadBytesLimited: v.boolean(),
  threadLimitReached: v.boolean(),
  items: v.array(
    v.object({
      threadId: v.id("forumThreads"),
      authorId: v.id("users"),
      agentSlug: v.string(),
      title: v.string(),
      url: v.string(),
      body: v.string(),
      issues: v.array(
        v.object({
          code: v.union(
            v.literal("empty_section"),
            v.literal("empty_callout"),
            v.literal("bare_step"),
            v.literal("declared_count_mismatch"),
            v.literal("missing_promised_content"),
            v.literal("unfinished_transition"),
            v.literal("unresolved_pointer"),
            v.literal("source_topic_mismatch"),
            v.literal("board_topic_mismatch"),
          ),
          message: v.string(),
        }),
      ),
      snapshot: v.object({
        bodyHash: v.string(),
        titleHash: v.string(),
        updatedAt: v.number(),
        categoryId: v.id("forumCategories"),
        categorySlug: v.string(),
        lastEditedAt: v.union(v.number(), v.null()),
        lastEditedBy: v.union(v.id("users"), v.null()),
        lastEditReason: v.union(v.string(), v.null()),
        editCount: v.number(),
        status: v.union(v.literal("active"), v.literal("locked")),
      }),
      sourceVerification: v.literal("not_performed"),
    }),
  ),
  notes: v.array(v.string()),
});
type ForumContentReviewQueue = Infer<typeof contentReviewQueueValidator>;

function normalizeLimits(args: SnapshotArgs) {
  if (
    !Number.isFinite(args.startAt) ||
    !Number.isFinite(args.endAt) ||
    args.startAt < 0 ||
    args.endAt <= args.startAt ||
    args.endAt - args.startAt > MAX_WINDOW_MS
  )
    throw new ConvexError({
      code: "INVALID_WINDOW",
      message: "Choose a finite, ordered window of at most 90 days.",
    });
  const integer = (
    value: number | undefined,
    defaultValue: number,
    max: number,
  ) => {
    if (value === undefined) return defaultValue;
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new ConvexError({
        code: "INVALID_LIMIT",
        message: `Choose an integer limit between 1 and ${max}.`,
      });
    return value;
  };
  return {
    limit: integer(args.limit, MAX_THREADS, MAX_THREADS),
    replyLimit: integer(args.replyLimit, 10, MAX_REPLIES),
  };
}

async function requireHumanForumAdmin(ctx: QueryCtx, authorizationAt: number) {
  const userId = await getFirstPartyAuthUserId(ctx);
  const user = userId === null ? null : await ctx.db.get("users", userId);
  const legacyAdmin = user?.role === "owner" || user?.role === "admin";
  if (
    user === null ||
    user.isAgent === true ||
    (!legacyAdmin &&
      (user.forumRole !== "admin" ||
        user.forumBannedAt !== undefined ||
        (user.forumSuspendedUntil ?? 0) > authorizationAt))
  )
    throw new ConvexError({
      code: user === null ? "AUTH_REQUIRED" : "UNAUTHORIZED",
      message: "Sign in with a human forum administrator account.",
    });
}

type ReadCache = {
  categories: Map<
    Id<"forumCategories">,
    Promise<Doc<"forumCategories"> | null>
  >;
  users: Map<Id<"users">, Promise<Doc<"users"> | null>>;
};
async function publicBoard(
  ctx: QueryCtx,
  id: Id<"forumCategories">,
  cache: ReadCache,
) {
  const seen = new Set<Id<"forumCategories">>();
  let next: Id<"forumCategories"> | undefined = id;
  let board: Doc<"forumCategories"> | null = null;
  for (let depth = 0; next !== undefined && depth < 16; depth += 1) {
    if (seen.has(next)) return null;
    seen.add(next);
    let read = cache.categories.get(next);
    if (!read) {
      read = ctx.db.get("forumCategories", next);
      cache.categories.set(next, read);
    }
    const category: Doc<"forumCategories"> | null = await read;
    // Fail closed for legacy unset access, private ancestors and test boards.
    if (
      !category ||
      category.status !== "active" ||
      category.viewAccess !== "public" ||
      !isForumDiscoveryBoard(category.slug)
    )
      return null;
    if (board === null) board = category;
    if (category.parentCategoryId === undefined) return board;
    next = category.parentCategoryId;
  }
  return null;
}
function readUser(ctx: QueryCtx, id: Id<"users">, cache: ReadCache) {
  let read = cache.users.get(id);
  if (!read) {
    read = ctx.db.get("users", id);
    cache.users.set(id, read);
  }
  return read;
}

export async function readCommunitySample(
  ctx: QueryCtx,
  args: SnapshotArgs,
): Promise<ForumCommunitySnapshot> {
  const { limit, replyLimit } = normalizeLimits(args);
  const candidatePage = await ctx.db
    .query("forumThreads")
    .withIndex("by_lastPostAt", (q) =>
      q.gte("lastPostAt", args.startAt).lte("lastPostAt", args.endAt),
    )
    .order("desc")
    .paginate({
      cursor: null,
      numItems: MAX_SCAN + 1,
      maximumRowsRead: MAX_SCAN + 1,
      maximumBytesRead: CANDIDATE_READ_BYTES,
    });
  const candidates = candidatePage.page;
  const cache: ReadCache = { categories: new Map(), users: new Map() };
  const threads: {
    thread: Doc<"forumThreads">;
    board: Doc<"forumCategories">;
  }[] = [];
  let examined = 0;
  for (const thread of candidates.slice(0, MAX_SCAN)) {
    examined += 1;
    if (thread.status !== "active" && thread.status !== "locked") continue;
    const board = await publicBoard(ctx, thread.categoryId, cache);
    if (board !== null) threads.push({ thread, board });
    if (threads.length >= limit) break;
  }
  const observations: CommunityThreadObservation[] = [];
  const summaries = [];
  let replyReadBudgetLimited = false;
  for (const { thread, board } of threads) {
    // Reserve enough room for the maximum 20 replies and uncached author docs.
    // Return partial measurements rather than exceeding transaction read limits.
    if (
      (await ctx.meta.getTransactionMetrics()).bytesRead.remaining <
      REPLY_READ_RESERVE
    ) {
      replyReadBudgetLimited = true;
      break;
    }
    const author = await readUser(ctx, thread.authorId, cache);
    const posts = await ctx.db
      .query("forumPosts")
      .withIndex("by_threadId_and_status_and_createdAt", (q) =>
        q
          .eq("threadId", thread._id)
          .eq("status", "active")
          .gte("createdAt", args.startAt)
          .lte("createdAt", args.endAt),
      )
      .order("desc")
      .take(replyLimit + 1);
    const sampledPosts = posts.slice(0, replyLimit).reverse();
    const replies = await Promise.all(
      sampledPosts.map(async (post) => ({
        actorKind: communityActorKind(
          await readUser(ctx, post.authorId, cache),
          post.agentAssisted,
        ),
        isThreadAuthor: post.authorId === thread.authorId,
      })),
    );
    const accepted = thread.acceptedPostId
      ? await ctx.db.get("forumPosts", thread.acceptedPostId)
      : null;
    const acceptedAnswerValid =
      thread.kind === "question" &&
      accepted?.threadId === thread._id &&
      accepted.status === "active";
    const publication = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_threadId_and_startedAt", (q) =>
        q.eq("threadId", thread._id),
      )
      .order("desc")
      .take(1);
    const followUp =
      publication[0]?.status === "published" && publication[0]?.followUpPostId
        ? await ctx.db.get("forumPosts", publication[0].followUpPostId)
        : null;
    const observation: CommunityThreadObservation = {
      threadId: thread._id,
      actorKind: communityActorKind(author, thread.agentAssisted),
      kind: thread.kind ?? "discussion",
      totalPublishedReplies: thread.replyCount,
      acceptedAnswerValid,
      replies,
      repliesLimited: posts.length > replyLimit,
      publicationFollowUpValid:
        followUp !== null &&
        followUp.threadId === thread._id &&
        followUp.status === "active" &&
        followUp.authorId === thread.authorId &&
        followUp.createdAt >= args.startAt &&
        followUp.createdAt <= args.endAt,
    };
    observations.push(observation);
    summaries.push({
      threadId: thread._id,
      title: thread.title,
      url: `${FORUM_SITE_URL}/${board.slug}/${thread.slug}`,
      createdAt: thread.createdAt,
      lastPostAt: thread.lastPostAt,
      actorKind: observation.actorKind,
      kind: observation.kind,
      publishedReplyCount: thread.replyCount,
      sampledReplyCount: replies.length,
      repliesLimited: observation.repliesLimited,
      acceptedAnswerValid,
      publicationFollowUpValid: observation.publicationFollowUpValid,
    });
  }
  return {
    window: {
      startAt: args.startAt,
      endAt: args.endAt,
      selection: "lastPostAt" as const,
    },
    limits: { threadLimit: limit, replyLimit, scanLimit: MAX_SCAN },
    coverage: {
      examinedThreads: examined,
      selectedThreads: threads.length,
      measuredThreads: observations.length,
      unmeasuredSelectedThreads: threads.length - observations.length,
      scanLimited: candidates.length > MAX_SCAN || !candidatePage.isDone,
      candidateReadBytesLimited:
        !candidatePage.isDone && candidates.length <= MAX_SCAN,
      replyReadBudgetLimited,
      threadLimitReached: threads.length === limit,
      excludedExaminedThreads: examined - threads.length,
      notes: [...COMMUNITY_OUTCOME_COVERAGE_NOTES],
    },
    outcomes: deriveForumCommunityOutcomes(observations),
    threads: summaries,
  };
}

export const readSnapshot = internalQuery({
  args: { ...snapshotArgs, authorizationAt: v.number() },
  returns: communitySnapshotValidator,
  handler: async (ctx, args): Promise<ForumCommunitySnapshot> => {
    await requireHumanForumAdmin(ctx, args.authorizationAt);
    return await readCommunitySample(ctx, args);
  },
});

/** The action supplies server time for current account restrictions, rather
 * than trusting a caller's historical window or reading wall time in a query. */
export const snapshot = action({
  args: snapshotArgs,
  returns: communitySnapshotValidator,
  handler: async (ctx, args): Promise<ForumCommunitySnapshot> => {
    return await ctx.runQuery(internal.forumCommunityQuality.readSnapshot, {
      ...args,
      authorizationAt: Date.now(),
    });
  },
});

/** Read-only triage. No draft, public post, moderation or publication is changed.
 * Defects are screen findings, not an automated determination of factual truth. */
export const contentReviewQueue = internalQuery({
  args: snapshotArgs,
  returns: contentReviewQueueValidator,
  handler: async (ctx, args): Promise<ForumContentReviewQueue> => {
    const { limit } = normalizeLimits(args);
    const candidatePage = await ctx.db
      .query("forumThreads")
      .withIndex("by_lastPostAt", (q) =>
        q.gte("lastPostAt", args.startAt).lte("lastPostAt", args.endAt),
      )
      .order("desc")
      .paginate({
        cursor: null,
        numItems: MAX_SCAN + 1,
        maximumRowsRead: MAX_SCAN + 1,
        maximumBytesRead: CANDIDATE_READ_BYTES,
      });
    const candidates = candidatePage.page;
    const cache: ReadCache = { categories: new Map(), users: new Map() };
    const items = [];
    let checked = 0;
    for (const thread of candidates.slice(0, MAX_SCAN)) {
      if (thread.status !== "active" && thread.status !== "locked") continue;
      const board = await publicBoard(ctx, thread.categoryId, cache);
      if (board === null) continue;
      const author = await readUser(ctx, thread.authorId, cache);
      if (author?.isAgent !== true) continue;
      const internalAgent = await ctx.db
        .query("forumAgents")
        .withIndex("by_userId", (q) => q.eq("userId", thread.authorId))
        .take(1);
      if (internalAgent.length === 0) continue;
      checked += 1;
      const completeness = validateForumContentCompleteness(thread.body, {
        title: thread.title,
      });
      const fit = assessForumContentFit({
        title: thread.title,
        body: thread.body,
        board,
        sources: [],
      });
      const issues = [...completeness.issues, ...fit.issues];
      if (issues.length > 0)
        items.push({
          threadId: thread._id,
          authorId: thread.authorId,
          agentSlug: internalAgent[0].slug,
          title: thread.title,
          url: `${FORUM_SITE_URL}/${board.slug}/${thread.slug}`,
          body: thread.body,
          issues,
          snapshot: {
            bodyHash: await sha256Base64Url(thread.body),
            titleHash: await sha256Base64Url(thread.title),
            updatedAt: thread.updatedAt,
            categoryId: thread.categoryId,
            categorySlug: thread.categorySlug,
            lastEditedAt: thread.lastEditedAt ?? null,
            lastEditedBy: thread.lastEditedBy ?? null,
            lastEditReason: thread.lastEditReason ?? null,
            editCount: thread.editCount ?? 0,
            status: thread.status,
          },
          sourceVerification: "not_performed" as const,
        });
      if (checked >= limit) break;
    }
    return {
      window: { startAt: args.startAt, endAt: args.endAt },
      checkedInternalAgentThreads: checked,
      scanLimited: candidates.length > MAX_SCAN || !candidatePage.isDone,
      candidateReadBytesLimited:
        !candidatePage.isDone && candidates.length <= MAX_SCAN,
      threadLimitReached: checked === limit,
      items,
      notes: [
        "Recent-activity bounded sample; human, external-agent, private and plugin-review posts are excluded.",
        "Findings cover final-body completeness and obvious board mismatches. Sources and claims require review; uncertainty is not a defect.",
        "Any correction must recheck these exact hashes and current edit/visibility state before writing.",
      ],
    };
  },
});
