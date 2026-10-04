import { defineForumQuery } from "./forumOperationDefinitions";
import { getFirstPartyAuthUserId as getAuthUserId } from "./authz";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { getPublicEntity } from "./contentAccess";
import {
  FORUM_PRESENCE_ROOM,
  forumPresenceComponent,
} from "./forumPresenceComponent";

const USERNAME_PATTERN = /^sym-\d{1,8}$|^[a-z0-9][a-z0-9_-]{2,31}$/;
const FORUM_POST_PAGE_SIZE = 20;

type UserDoc = Doc<"users">;
type ForumCategoryDoc = Doc<"forumCategories">;
type ForumPresenceDoc = Doc<"forumPresence">;
type ForumUserProfileDoc = Doc<"forumUserProfiles">;

function normalizeUsername(value: string) {
  const usernameNormalized = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(usernameNormalized)) {
    throw new Error("Invalid username");
  }
  return usernameNormalized;
}

function publicUserProfile(user: Doc<"users">) {
  return {
    _creationTime: user._creationTime,
    username: user.username ?? user.name ?? "SYM-UNKNOWN",
    usernameNormalized:
      user.usernameNormalized ??
      (user.username ?? user.name ?? "").toLowerCase(),
    bio: user.bio,
    role: user.role,
    usernameSource: user.usernameSource,
    onboardedAt: user.onboardedAt,
  };
}

function forumRankForPostCount(postCount: number) {
  if (postCount >= 1_000) {
    return "Forum Elder";
  }
  if (postCount >= 250) {
    return "Senior Member";
  }
  if (postCount >= 50) {
    return "Full Member";
  }
  if (postCount >= 10) {
    return "Member";
  }
  return "New Member";
}

function forumReputationScore(profile: ForumUserProfileDoc | null) {
  return profile?.reputationScore ?? 0;
}

function forumThreadPrefixRecord(thread: Doc<"forumThreads">) {
  if (thread.prefixLabel === undefined && thread.prefixSlug === undefined) {
    return null;
  }
  return {
    _id: thread.prefixId,
    slug: thread.prefixSlug ?? "legacy",
    label: thread.prefixLabel ?? thread.prefixSlug ?? "Prefix",
    color: thread.prefixColor,
  };
}

async function publicForumProfile(ctx: QueryCtx, user: UserDoc) {
  const trusted = isTrustedForumUser(user);
  const [profile, presence, liveRooms] = await Promise.all([
    ctx.db
      .query("forumUserProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique(),
    trusted
      ? ctx.db
          .query("forumPresence")
          .withIndex("by_userId", (q) => q.eq("userId", user._id))
          .unique()
      : Promise.resolve(null),
    trusted
      ? forumPresenceComponent.listUser(ctx, String(user._id), true, 5)
      : Promise.resolve([]),
  ]);
  const postCount = profile?.postCount ?? 0;
  const online =
    trusted &&
    liveRooms.some(
      (room) => room.roomId === FORUM_PRESENCE_ROOM && room.online,
    );

  return {
    bio: profile?.bio,
    birthday: profile?.birthday,
    customTitle: profile?.customTitle,
    location: profile?.location,
    signature:
      profile?.showSignatures === false ? undefined : profile?.signature,
    showSignatures: profile?.showSignatures ?? true,
    timeZone: profile?.timeZone,
    threadCount: profile?.threadCount ?? 0,
    postCount,
    reputationScore: forumReputationScore(profile),
    rank: forumRankForPostCount(postCount),
    trusted,
    avatarUrl: profile?.avatarUrl ?? user.image,
    websiteUrl: profile?.websiteUrl,
    joinedAt: user._creationTime,
    isOnline: online,
    lastSeenAt: online ? presence?.updatedAt : undefined,
    onlineLocation:
      online && presence !== null
        ? publicProfilePresenceLocation(presence)
        : undefined,
  };
}

function publicProfilePresenceLocation(presence: ForumPresenceDoc) {
  if (presence.locationType === "index") {
    return { label: "Board index", href: "/forum" };
  }
  if (presence.locationType === "search") {
    return { label: "Searching forums", href: "/forum/search" };
  }
  if (presence.locationType === "members") {
    return { label: "Member directory", href: "/forum/members" };
  }
  if (presence.locationType === "help") {
    return { label: "Reading help", href: "/forum/help" };
  }
  if (presence.locationType === "calendar") {
    return { label: "Browsing calendar", href: "/forum/calendar" };
  }
  if (presence.locationType === "board") {
    return { label: "Viewing board" };
  }
  if (presence.locationType === "thread") {
    return { label: "Reading thread" };
  }
  return { label: "Forum tools" };
}

async function recentComments(ctx: QueryCtx, userId: Id<"users">) {
  const rows = await ctx.db
    .query("comments")
    .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
    .order("desc")
    .take(20);
  const publicRows = await Promise.all(
    rows.map(async (comment) => {
      if ((comment.status ?? "active") !== "active") {
        return null;
      }
      const target = await getPublicEntity(
        ctx,
        comment.entityType,
        comment.entityId,
      );
      return target === null ? null : comment;
    }),
  );
  return publicRows
    .filter(
      (comment): comment is NonNullable<typeof comment> => comment !== null,
    )
    .slice(0, 5);
}

async function recentForumActivity(
  ctx: QueryCtx,
  userId: Id<"users">,
  viewer: UserDoc | null,
) {
  const [threadRows, postRows] = await Promise.all([
    ctx.db
      .query("forumThreads")
      .withIndex("by_authorId_and_createdAt", (q) => q.eq("authorId", userId))
      .order("desc")
      .take(10),
    ctx.db
      .query("forumPosts")
      .withIndex("by_authorId_and_createdAt", (q) => q.eq("authorId", userId))
      .order("desc")
      .take(10),
  ]);
  const postThreads = await Promise.all(
    postRows.map(
      async (post) =>
        [post, await ctx.db.get("forumThreads", post.threadId)] as const,
    ),
  );
  const categoryIds = [
    ...threadRows.map((thread) => thread.categoryId),
    ...postThreads.flatMap(([, thread]) =>
      thread === null ? [] : [thread.categoryId],
    ),
  ];
  const categories = await Promise.all(
    [...new Set(categoryIds)].map(
      async (categoryId) =>
        [categoryId, await ctx.db.get("forumCategories", categoryId)] as const,
    ),
  );
  const visibleCategoryIds = new Set(
    (
      await Promise.all(
        categories.map(async ([categoryId, category]) =>
          category !== null &&
          (await canViewForumCategoryWithAncestors(ctx, viewer, category))
            ? categoryId
            : null,
        ),
      )
    ).filter(
      (categoryId): categoryId is Id<"forumCategories"> => categoryId !== null,
    ),
  );
  const visibleThreads = threadRows
    .filter(
      (thread) =>
        visibleCategoryIds.has(thread.categoryId) &&
        (thread.status === "active" || thread.status === "locked"),
    )
    .slice(0, 5);
  const visiblePosts = postThreads
    .filter(
      ([post, thread]) =>
        post.status === "active" &&
        thread !== null &&
        visibleCategoryIds.has(thread.categoryId) &&
        (thread.status === "active" || thread.status === "locked"),
    )
    .slice(0, 5);

  return {
    threads: visibleThreads.map((thread) => ({
      _id: thread._id,
      categorySlug: thread.categorySlug,
      prefix: forumThreadPrefixRecord(thread),
      slug: thread.slug,
      title: thread.title,
      replyCount: thread.replyCount,
      createdAt: thread.createdAt,
      lastPostAt: thread.lastPostAt,
    })),
    replies: visiblePosts.map(([post, thread]) => ({
      _id: post._id,
      categorySlug: thread!.categorySlug,
      threadSlug: thread!.slug,
      threadTitle: thread!.title,
      prefix: forumThreadPrefixRecord(thread!),
      excerpt: excerpt(post.body, 180),
      postNumber: post.postNumber,
      postPage:
        post.postNumber === undefined
          ? undefined
          : Math.max(1, Math.ceil(post.postNumber / FORUM_POST_PAGE_SIZE)),
      createdAt: post.createdAt,
    })),
  };
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not signed in");
    }
    const user = await ctx.db.get("users", userId);
    if (user === null) {
      throw new Error("User was deleted");
    }
    return user;
  },
});

export const maybeViewer = query({
  args: { includeBio: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const user = await ctx.db.get("users", userId);
    if (user === null) {
      return null;
    }
    const forumProfile = args.includeBio
      ? await ctx.db
          .query("forumUserProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique()
      : null;
    return {
      _id: user._id,
      _creationTime: user._creationTime,
      name: user.name,
      username: user.username,
      usernameNormalized: user.usernameNormalized,
      usernameSource: user.usernameSource,
      role: user.role,
      forumRole: user.forumRole,
      contactEmail: user.contactEmail,
      emailVerified: user.emailVerificationTime !== undefined,
      ...(args.includeBio
        ? { bio: user.bio ?? forumProfile?.bio }
        : {}),
      onboardedAt: user.onboardedAt,
      isAgent: user.isAgent,
      canEnrollAgent:
        user.emailVerificationTime !== undefined ||
        user.role === "owner" ||
        user.role === "admin",
    };
  },
});

export const publicProfileOperation = defineForumQuery({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    let usernameNormalized: string;
    try {
      usernameNormalized = normalizeUsername(args.username);
    } catch {
      return null;
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", usernameNormalized),
      )
      .unique();

    if (user === null) {
      return null;
    }

    const viewerId = await getAuthUserId(ctx);
    const viewer =
      viewerId === null ? null : await ctx.db.get("users", viewerId);
    const [comments, forumActivity, forumProfile] = await Promise.all([
      recentComments(ctx, user._id),
      recentForumActivity(ctx, user._id, viewer),
      publicForumProfile(ctx, user),
    ]);

    return {
      user: publicUserProfile(user),
      forumProfile,
      isCurrentUser: viewerId === user._id,
      recentComments: comments.map((comment) => ({
        _id: comment._id,
        entityType: comment.entityType,
        entityId: comment.entityId,
        body: comment.body,
        createdAt: comment.createdAt,
      })),
      recentForumThreads: forumActivity.threads,
      recentForumReplies: forumActivity.replies,
    };
  },
});
export const publicProfile = query(publicProfileOperation);

function canModerate(user: UserDoc | null | undefined) {
  return user?.role === "owner" || user?.role === "admin";
}

function isActiveForumAccount(user: UserDoc | null | undefined) {
  if (user === null || user === undefined || canModerate(user)) {
    return true;
  }
  if (user.forumBannedAt !== undefined) {
    return false;
  }
  return (
    user.forumSuspendedUntil === undefined ||
    user.forumSuspendedUntil <= Date.now()
  );
}

function isTrustedForumUser(user: UserDoc | null | undefined) {
  if (canModerate(user)) {
    return true;
  }
  return (
    isActiveForumAccount(user) &&
    user?.forumTrustedAt !== undefined &&
    user.forumTrustRevokedAt === undefined
  );
}

function categoryKind(category: ForumCategoryDoc) {
  return category.kind ?? "board";
}

function categoryViewAccess(category: ForumCategoryDoc) {
  return category.viewAccess ?? "public";
}

function canUseForumCategoryViewAccess(
  user: UserDoc | null | undefined,
  category: ForumCategoryDoc | null | undefined,
) {
  if (user !== null && user !== undefined && !isActiveForumAccount(user)) {
    return false;
  }
  if (
    category === null ||
    category === undefined ||
    category.status !== "active"
  ) {
    return false;
  }

  const access = categoryViewAccess(category);
  if (access === "public") {
    return true;
  }
  if (access === "members") {
    return user !== null && user !== undefined;
  }
  if (access === "trusted") {
    return isTrustedForumUser(user);
  }
  return canModerate(user);
}

function canViewForumCategory(
  user: UserDoc | null | undefined,
  category: ForumCategoryDoc | null | undefined,
): category is ForumCategoryDoc {
  if (
    category === null ||
    category === undefined ||
    categoryKind(category) !== "board"
  ) {
    return false;
  }

  return canUseForumCategoryViewAccess(user, category);
}

async function canViewForumCategoryWithAncestors(
  ctx: QueryCtx,
  user: UserDoc | null | undefined,
  category: ForumCategoryDoc | null | undefined,
) {
  if (!canViewForumCategory(user, category)) {
    return false;
  }

  let parentCategoryId = category.parentCategoryId;
  for (
    let depth = 0;
    depth < 10 && parentCategoryId !== undefined;
    depth += 1
  ) {
    const parent = await ctx.db.get("forumCategories", parentCategoryId);
    if (parent === null || !canUseForumCategoryViewAccess(user, parent)) {
      return false;
    }
    parentCategoryId = parent.parentCategoryId;
  }
  return parentCategoryId === undefined;
}

function excerpt(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 1)}...`;
}
