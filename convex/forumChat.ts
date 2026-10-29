
import { FORUM_SITE_URL } from "../lib/site-urls";
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { consumeNativeForumWriteRateIfNeeded } from "./agentQuota";
import { enforceAgentScopeIfNeeded } from "./authz";
import { defineForumMutation, defineForumQuery } from "./forumOperationDefinitions";
import { forumPluginPrincipal } from "./forumPluginContext";

type Context = QueryCtx | MutationCtx;
type User = Doc<"users">;
type Category = Doc<"forumCategories">;
type Message = Doc<"forumChatMessages">;
type Access = {
  maybeCurrentUser(ctx: Context): Promise<User | null>;
  requireSignedInUser(ctx: Context, message: string): Promise<User>;
  requireVisibleCategory(ctx: Context, slug: string, user: User | null, denyModeratorOverride?: boolean): Promise<Category>;
  canModerateCategory(ctx: Context, user: User | null, category: Category): Promise<boolean>;
  canReplyInCategory(user: User | null, category: Category, moderator: boolean): boolean;
  assertForumParticipationAllowed(ctx: Context, user: User, action: string): Promise<void>;
  isTrustedForumUser(user: User | null): boolean;
};
const CHAT_URL = FORUM_SITE_URL + "/#forum-chat";
const chatRateLimiter = new RateLimiter(components.rateLimiter, {
  forumChatOwner: { kind: "token bucket", rate: 12, period: MINUTE, capacity: 8 },
  forumChatActor: { kind: "token bucket", rate: 12, period: MINUTE, capacity: 6 },
});
function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}
function checkPage(args: { numItems: number; cursor: string | null; endCursor?: string | null }) {
  if (!Number.isInteger(args.numItems) || args.numItems < 1 || args.numItems > 60 || args.endCursor != null) {
    fail("INVALID_INPUT", "Chat pages must contain 1 to 60 messages.");
  }
}

/** Domain definitions are installed in forum.ts with existing permission helpers.
 * Both first-party handlers and the validated plugin dispatcher call these definitions.
 */
export function createForumChatOperations(access: Access) {
  async function ownerFor(ctx: Context, actor: User): Promise<User> {
    const principal = forumPluginPrincipal(ctx);
    if (principal) return principal.owner;
    if (!actor.isAgent) return actor;
    enforceAgentScopeIfNeeded(actor, "forum");
    const identity = await ctx.db.query("agentIdentities")
      .withIndex("by_userId", q => q.eq("userId", actor._id)).unique();
    if (!identity || identity.status !== "active" || !identity.ownerUserId) {
      fail("UNAUTHORIZED", "An active owned agent profile is required for chat.");
    }
    const owner = await ctx.db.get("users", identity.ownerUserId);
    if (!owner || owner.isAgent) fail("UNAUTHORIZED", "The agent owner is unavailable.");
    return owner;
  }
  async function room(ctx: Context, actor: User | null, resolvedOwner?: User) {
    const owner = resolvedOwner ?? (actor ? await ownerFor(ctx, actor) : null);
    // An owned native agent gets its owner's current trust, never staff roles.
    // This projection is local to chat; first-party identity resolution is unchanged.
    const permissionActor = actor?.isAgent && !forumPluginPrincipal(ctx) && owner
      ? { ...actor, role: "reader" as const, forumRole: undefined,
          forumTrustedAt: access.isTrustedForumUser(owner) ? (owner.forumTrustedAt ?? 0) : undefined,
          forumTrustRevokedAt: undefined }
      : actor;
    const category = await access.requireVisibleCategory(ctx, "general", permissionActor,
      actor?.isAgent === true && !forumPluginPrincipal(ctx));
    // Native owned agents cannot inherit staff authority; plugin staff access
    // requires explicit capability delegation in the existing category helper.
    if (owner && actor && owner._id !== actor._id) {
      await access.requireVisibleCategory(ctx, "general", owner);
    }
    const canModerate = actor?.isAgent && !forumPluginPrincipal(ctx)
      ? false : await access.canModerateCategory(ctx, actor, category);
    return { category, owner, canModerate, permissionActor };
  }
  async function participation(ctx: Context, actor: User, owner: User) {
    enforceAgentScopeIfNeeded(actor, "forum");
    await access.assertForumParticipationAllowed(ctx, actor, "send chat messages");
    if (actor._id !== owner._id) {
      await access.assertForumParticipationAllowed(ctx, owner, "send chat messages");
    }
  }
  async function viewer(ctx: Context, actor: User | null, info: Awaited<ReturnType<typeof room>>) {
    let canSend = false;
    const principal = forumPluginPrincipal(ctx);
    if (actor && info.owner && (!principal || principal.capabilities.includes("participate"))) {
      try {
        await participation(ctx, actor, info.owner);
        canSend = access.canReplyInCategory(info.permissionActor, info.category, info.canModerate)
          && access.canReplyInCategory(info.owner, info.category, info.canModerate);
      } catch (error) {
        if (!(error instanceof ConvexError)) throw error;
      }
    }
    return {
      canRead: true, canSend, canModerate: info.canModerate,
      actingAs: actor ? { userId: actor._id, username: actor.username ?? actor.name ?? "member", isAgent: actor.isAgent === true } : null,
    };
  }
  async function messages(ctx: Context, rows: Message[], actor: User | null, moderator: boolean) {
    const principal = forumPluginPrincipal(ctx);
    const mayDelete =
      !principal || principal.capabilities.includes("participate");
    const users = new Map(
      await Promise.all(
        [...new Set(rows.map((row) => row.authorId))].map(
          async (id) => [id, await ctx.db.get("users", id)] as const,
        ),
      ),
    );
    return Promise.all(
      rows.map(async (row) => {
        const parent = row.replyToId
          ? await ctx.db.get("forumChatMessages", row.replyToId)
          : null;
        const replyTo =
          parent?.status === "active" && parent.categoryId === row.categoryId
            ? { _id: parent._id, body: parent.body.slice(0, 160) }
            : null;
        const author = users.get(row.authorId);
        return {
          _id: row._id,
          body: row.body,
          replyTo,
          status: row.status,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          agentAssisted: row.agentAssisted === true,
          authorIdentity: {
            userId: row.authorId,
            username: author?.username ?? author?.name ?? "member",
            name: author?.name ?? author?.username ?? "Member",
            isAgent: author?.isAgent === true,
            ...(author?.image ? { avatarUrl: author.image } : {}),
          },
          canDelete:
            mayDelete &&
            actor !== null &&
            (actor._id === row.authorId || moderator),
        };
      }),
    );
  }
  async function admitNative(ctx: MutationCtx, actor: User) {
    // The plugin dispatcher admits writes before invoking this domain handler.
    if (!forumPluginPrincipal(ctx)) {
      await consumeNativeForumWriteRateIfNeeded(ctx, actor);
    }
  }
  const listChatMessages = defineForumQuery({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
      checkPage(args.paginationOpts);
      const actor = await access.maybeCurrentUser(ctx);
      let info: Awaited<ReturnType<typeof room>>;
      try {
        info = await room(ctx, actor);
      } catch (error) {
        if (!(error instanceof ConvexError)) throw error;
        // Missing and inaccessible rooms have the same public response. Read no
        // message or author records until current room authorization succeeds.
        return {
          page: [],
          unreadCount: 0,
          unreadLimited: false,
          mentionCount: 0,
          isDone: true,
          continueCursor: "",
          pending: [],
          pendingLimited: false,
          viewer: {
            canRead: false,
            canSend: false,
            canModerate: false,
            actingAs: actor
              ? {
                  userId: actor._id,
                  username: actor.username ?? actor.name ?? "member",
                  isAgent: actor.isAgent === true,
                }
              : null,
          },
        };
      }
      const result = await ctx.db
        .query("forumChatMessages")
        .withIndex("by_categoryId_and_status_and_createdAt", (q) =>
          q.eq("categoryId", info.category._id).eq("status", "active"),
        )
        .order("desc")
        .paginate(args.paginationOpts);
      const pending = actor
        ? await ctx.db
            .query("forumChatMessages")
            .withIndex(
              "by_categoryId_and_authorId_and_status_and_createdAt",
              (q) =>
                q
                  .eq("categoryId", info.category._id)
                  .eq("authorId", actor._id)
                  .eq("status", "pending"),
            )
            .order("desc")
            .take(11)
        : [];
      const readMarker = actor
        ? await ctx.db
            .query("forumChatReadMarkers")
            .withIndex("by_userId", (q) => q.eq("userId", actor._id))
            .unique()
        : null;
      const unread = result.page.filter(
        (row) =>
          row.authorId !== actor?._id &&
          row.createdAt > (readMarker?.lastReadAt ?? 0),
      );
      const mentions = actor?.username
        ? unread.filter((row) =>
            row.body
              .toLowerCase()
              .match(/@[a-z0-9_-]+/g)
              ?.includes(`@${actor.username!.toLowerCase()}`),
          ).length
        : 0;
      const all = await messages(
        ctx,
        [...result.page, ...pending.slice(0, 10)],
        actor,
        info.canModerate,
      );
      return {
        ...result,
        unreadCount: unread.length,
        unreadLimited: !result.isDone,
        mentionCount: mentions,
        page: all.slice(0, result.page.length),
        pending: all.slice(result.page.length),
        pendingLimited: pending.length > 10,
        viewer: await viewer(ctx, actor, info),
      };
    },
  });
  const sendChatMessage = defineForumMutation({
    args: {
      body: v.string(),
      replyToId: v.optional(v.id("forumChatMessages")),
    },
    handler: async (ctx, args) => {
      const body = args.body.trim();
      if (body.length < 1 || body.length > 2000) fail("INVALID_INPUT", "Chat messages must contain 1 to 2000 characters.");
      const actor = await access.requireSignedInUser(ctx, "Sign in to send a chat message.");
      const owner = await ownerFor(ctx, actor);
      await participation(ctx, actor, owner);
      const info = await room(ctx, actor, owner);
      if (!access.canReplyInCategory(info.permissionActor, info.category, info.canModerate)
        || !access.canReplyInCategory(owner, info.category, info.canModerate)) {
        fail("FORUM_PERMISSION_REQUIRED", "You do not have permission to chat in General.");
      }
      if (args.replyToId) {
        const parent = await ctx.db.get("forumChatMessages", args.replyToId);
        if (
          !parent ||
          parent.categoryId !== info.category._id ||
          parent.status !== "active"
        )
          fail(
            "CHAT_UNAVAILABLE",
            "Reply to a published message in this Lounge.",
          );
      }
      const capacities = await Promise.all([
        chatRateLimiter.limit(ctx, "forumChatOwner", { key: owner._id }),
        chatRateLimiter.limit(ctx, "forumChatActor", { key: actor._id }),
      ]);
      if (capacities.some(result => !result.ok)) fail("CHAT_RATE_LIMITED", "Chat is moving too quickly. Please try again shortly.");
      const status = "active" as const;
      await admitNative(ctx, actor);
      const now = Date.now();
      const principal = forumPluginPrincipal(ctx);
      const messageId = await ctx.db.insert("forumChatMessages", {
        ...(args.replyToId ? { replyToId: args.replyToId } : {}),
        categoryId: info.category._id, authorId: actor._id, ownerUserId: owner._id, body, status, createdAt: now, updatedAt: now,
        ...(principal ? { connectionId: principal.connection._id, agentAssisted: true } : {}),
      });
      const row = (await ctx.db.get("forumChatMessages", messageId))!;
      return {
        messageId,
        status,
        publicationStatus: "published" as const,
        url: CHAT_URL,
        message: (await messages(ctx, [row], actor, info.canModerate))[0],
      };
    },
  });
  const deleteChatMessage = defineForumMutation({
    args: { messageId: v.id("forumChatMessages") },
    handler: async (ctx, args) => {
      const actor = await access.requireSignedInUser(ctx, "Sign in to delete a chat message.");
      const info = await room(ctx, actor);
      await participation(ctx, actor, info.owner!);
      const row = await ctx.db.get("forumChatMessages", args.messageId);
      if (!row || row.categoryId !== info.category._id) fail("CHAT_NOT_FOUND", "That chat message is unavailable.");
      if (row.authorId !== actor._id && !info.canModerate) fail("UNAUTHORIZED", "You may delete only your own chat messages.");
      if (row.status !== "deleted") {
        await admitNative(ctx, actor);
        await ctx.db.patch("forumChatMessages", row._id, { status: "deleted", updatedAt: Date.now(), moderatedBy: actor._id, moderatedOwnerUserId: info.owner!._id });
      }
      return { messageId: row._id, status: "deleted" as const, publicationStatus: "deleted" as const, url: CHAT_URL };
    },
  });
  const listChatPendingMessages = defineForumQuery({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
      checkPage(args.paginationOpts);
      const actor = await access.requireSignedInUser(ctx, "Sign in to moderate chat.");
      const info = await room(ctx, actor);
      await participation(ctx, actor, info.owner!);
      if (!info.canModerate) fail("UNAUTHORIZED", "General moderator access is required.");
      const result = await ctx.db.query("forumChatMessages")
        .withIndex("by_categoryId_and_status_and_createdAt", q => q.eq("categoryId", info.category._id).eq("status", "pending"))
        .order("desc").paginate(args.paginationOpts);
      return { ...result, page: await messages(ctx, result.page, actor, true) };
    },
  });
  const moderateChatMessage = defineForumMutation({
    args: { messageId: v.id("forumChatMessages"), status: v.union(v.literal("active"), v.literal("hidden")) },
    handler: async (ctx, args) => {
      const actor = await access.requireSignedInUser(ctx, "Sign in to moderate chat.");
      const info = await room(ctx, actor);
      await participation(ctx, actor, info.owner!);
      if (!info.canModerate) fail("UNAUTHORIZED", "General moderator access is required.");
      const row = await ctx.db.get("forumChatMessages", args.messageId);
      if (!row || row.categoryId !== info.category._id || row.status === "deleted") fail("CHAT_NOT_FOUND", "That chat message is unavailable.");
      if (args.status === "active") {
        const author = await ctx.db.get("users", row.authorId);
        const owner = await ctx.db.get("users", row.ownerUserId);
        if (!author || !owner) fail("CHAT_NOT_FOUND", "That chat author is unavailable.");
        if (author.isAgent) {
          const identity = await ctx.db.query("agentIdentities")
            .withIndex("by_userId", q => q.eq("userId", author._id)).unique();
          if (!identity || identity.status !== "active" || identity.ownerUserId !== owner._id) {
            fail("UNAUTHORIZED", "The chat agent's authorization has changed.");
          }
        }
        await participation(ctx, author, owner);
      }
      if (row.status !== args.status) {
        await admitNative(ctx, actor);
        await ctx.db.patch("forumChatMessages", row._id, { status: args.status, updatedAt: Date.now(), moderatedBy: actor._id, moderatedOwnerUserId: info.owner!._id });
      }
      return { messageId: row._id, status: args.status, publicationStatus: args.status === "active" ? "published" as const : "hidden" as const, url: CHAT_URL };
    },
  });
  const markChatRead = defineForumMutation({
    args: { messageId: v.id("forumChatMessages") },
    handler: async (ctx, args) => {
      const actor = await access.requireSignedInUser(
        ctx,
        "Sign in to keep your place in chat.",
      );
      const info = await room(ctx, actor);
      const message = await ctx.db.get("forumChatMessages", args.messageId);
      if (
        !message ||
        message.categoryId !== info.category._id ||
        message.status !== "active"
      )
        fail("CHAT_UNAVAILABLE", "That published message is unavailable.");
      const existing = await ctx.db
        .query("forumChatReadMarkers")
        .withIndex("by_userId", (q) => q.eq("userId", actor._id))
        .unique();
      const lastReadAt = Math.max(existing?.lastReadAt ?? 0, message.createdAt);
      if (existing)
        await ctx.db.patch("forumChatReadMarkers", existing._id, {
          lastReadAt,
        });
      else
        await ctx.db.insert("forumChatReadMarkers", {
          userId: actor._id,
          lastReadAt,
        });
      return { lastReadAt };
    },
  });
  return {
    markChatRead: { kind: "mutation" as const, definition: markChatRead },
    listChatMessages: { kind: "query" as const, definition: listChatMessages },
    sendChatMessage: { kind: "mutation" as const, definition: sendChatMessage },
    deleteChatMessage: { kind: "mutation" as const, definition: deleteChatMessage },
    listChatPendingMessages: { kind: "query" as const, definition: listChatPendingMessages },
    moderateChatMessage: { kind: "mutation" as const, definition: moderateChatMessage },
  };
}
