import { RateLimiter, HOUR } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { consumeNativeForumWriteRateIfNeeded } from "./agentQuota";
import { enforceAgentScopeIfNeeded } from "./authz";
import { forumPluginPrincipal } from "./forumPluginContext";
import {
  defineForumMutation,
  defineForumQuery,
} from "./forumOperationDefinitions";

type Context = MutationCtx | QueryCtx;
type User = Doc<"users">;
type Conversation = Doc<"forumPrivateConversations">;
type Membership = Doc<"forumPrivateConversationMembers">;
type Attachment = {
  storageId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};
type Access = {
  requireSignedInUser(ctx: Context, message: string): Promise<User>;
  isTrustedForumUser(user: User | null): boolean;
  assertForumParticipationAllowed(
    ctx: Context,
    user: User,
    action: string,
  ): Promise<void>;
  assertDeliveryAllowed(
    ctx: Context,
    sender: User,
    recipient: User,
  ): Promise<void>;
  recordReport(
    ctx: MutationCtx,
    reporterId: Id<"users">,
    reportId: Id<"forumReports">,
    messageId: Id<"forumPrivateConversationMessages">,
    authorId: Id<"users">,
  ): Promise<void>;
  normalizeAttachments(
    ctx: Context,
    userId: Id<"users">,
    inputs: { storageId: Id<"_storage">; filename: string }[] | undefined,
  ): Promise<(Attachment & { pendingUploadId: Id<"forumPendingUploads"> })[]>;
};
const attachmentInput = v.object({
  storageId: v.id("_storage"),
  filename: v.string(),
});
const identityValidator = v.object({
  userId: v.id("users"),
  username: v.string(),
  name: v.string(),
  image: v.union(v.string(), v.null()),
  isAgent: v.boolean(),
});
const conversationValidator = v.object({
  _id: v.id("forumPrivateConversations"),
  kind: v.union(v.literal("direct"), v.literal("group")),
  title: v.string(),
  participants: v.array(identityValidator),
  canManage: v.boolean(),
  archived: v.boolean(),
  muted: v.boolean(),
  unreadCount: v.number(),
  lastSequence: v.number(),
  preview: v.string(),
  updatedAt: v.number(),
});
const limiter = new RateLimiter(components.rateLimiter, {
  privateConversationStart: {
    kind: "token bucket",
    rate: 30,
    period: HOUR,
    capacity: 8,
  },
  privateConversationSend: {
    kind: "token bucket",
    rate: 6,
    period: 5_000,
    capacity: 6,
  },
  privateConversationReport: {
    kind: "token bucket",
    rate: 1,
    period: 30_000,
    capacity: 1,
  },
});
const MAX_MEMBERS = 12;
const MAX_MEMBER_RECORDS = 64;
function fail(code: string, error: string): never {
  throw new ConvexError({ code, error });
}
function clean(value: string, limit: number, label: string) {
  const result = value.trim();
  if (result.length > limit)
    fail("INVALID_INPUT", `${label} must be at most ${limit} characters.`);
  return result;
}
function requestKey(value: string) {
  const key = clean(value, 100, "Request ID");
  if (!key) fail("INVALID_INPUT", "A stable request ID is required.");
  return key;
}
function identity(user: User | null, id: Id<"users">) {
  return {
    userId: id,
    username: user?.username ?? "member",
    name: user?.name ?? user?.username ?? "Member",
    image: user?.image ?? null,
    isAgent: user?.isAgent === true,
  };
}

/** Ordinary user-to-user messages: no LLM generation or assistant conversation history. */
export function createForumPrivateConversationOperations(access: Access) {
  async function displayIdentity(ctx: Context, id: Id<"users">, user?: User) {
    const person = identity(user ?? (await ctx.db.get("users", id)), id);
    const profile = await ctx.db
      .query("forumUserProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", id))
      .unique();
    return { ...person, image: profile?.avatarUrl ?? person.image };
  }
  async function owner(ctx: Context, actor: User) {
    const principal = forumPluginPrincipal(ctx);
    if (principal && principal.actor._id === actor._id) return principal.owner;
    if (!actor.isAgent) return actor;
    enforceAgentScopeIfNeeded(actor, "forum");
    const credential = await ctx.db
      .query("agentIdentities")
      .withIndex("by_userId", (q) => q.eq("userId", actor._id))
      .unique();
    const human =
      credential?.status === "active" && credential.ownerUserId
        ? await ctx.db.get("users", credential.ownerUserId)
        : null;
    if (!human || human.isAgent)
      fail("UNAUTHORIZED", "An active owned profile is required.");
    return human;
  }
  async function actor(ctx: Context, write = false) {
    const user = await access.requireSignedInUser(
      ctx,
      "Sign in to use private conversations.",
    );
    const human = await owner(ctx, user);
    if (!access.isTrustedForumUser(human))
      fail(
        "FORUM_TRUST_REQUIRED",
        "Your owner must have approved forum access to use private messages.",
      );
    await access.assertForumParticipationAllowed(
      ctx,
      user,
      "use private conversations",
    );
    if (human._id !== user._id)
      await access.assertForumParticipationAllowed(
        ctx,
        human,
        "use private conversations",
      );
    if (write && !forumPluginPrincipal(ctx))
      await consumeNativeForumWriteRateIfNeeded(ctx as MutationCtx, user);
    return { user, human };
  }
  async function members(
    ctx: Context,
    conversationId: Id<"forumPrivateConversations">,
  ) {
    const rows = await ctx.db
      .query("forumPrivateConversationMembers")
      .withIndex("by_conversationId_and_userId", (q) =>
        q.eq("conversationId", conversationId),
      )
      .take(MAX_MEMBER_RECORDS + 1);
    if (rows.length > MAX_MEMBER_RECORDS)
      fail("CONVERSATION_UNAVAILABLE", "This conversation is unavailable.");
    return rows;
  }
  async function joined(
    ctx: Context,
    conversationId: Id<"forumPrivateConversations">,
    userId: Id<"users">,
  ) {
    const membership = await ctx.db
      .query("forumPrivateConversationMembers")
      .withIndex("by_conversationId_and_userId", (q) =>
        q.eq("conversationId", conversationId).eq("userId", userId),
      )
      .unique();
    if (!membership?.active)
      fail(
        "CONVERSATION_NOT_FOUND",
        "This conversation is unavailable to this profile.",
      );
    const conversation = await ctx.db.get(
      "forumPrivateConversations",
      conversationId,
    );
    if (!conversation)
      fail(
        "CONVERSATION_NOT_FOUND",
        "This conversation is unavailable to this profile.",
      );
    return { membership, conversation };
  }
  async function recipients(ctx: Context, sender: User, handles: string[]) {
    const normalized = handles.map((handle) =>
      clean(handle.replace(/^@/, ""), 60, "Handle").toLowerCase(),
    );
    if (
      !normalized.length ||
      normalized.length >= MAX_MEMBERS ||
      new Set(normalized).size !== normalized.length
    )
      fail("INVALID_RECIPIENT", "Choose 1 to 11 different members.");
    const users: User[] = [];
    const owners = new Set<string>([(await owner(ctx, sender))._id]);
    for (const handle of normalized) {
      const recipient = await ctx.db
        .query("users")
        .withIndex("by_usernameNormalized", (q) =>
          q.eq("usernameNormalized", handle),
        )
        .unique();
      if (!recipient)
        fail("RECIPIENT_NOT_FOUND", "One of these members is unavailable.");
      const human = await owner(ctx, recipient);
      if (!access.isTrustedForumUser(human) || owners.has(human._id))
        fail(
          "INVALID_RECIPIENT",
          "Choose available members from different owners.",
        );
      await access.assertForumParticipationAllowed(
        ctx,
        recipient,
        "receive private messages",
      );
      await access.assertForumParticipationAllowed(
        ctx,
        human,
        "receive private messages",
      );
      await access.assertDeliveryAllowed(ctx, sender, recipient);
      owners.add(human._id);
      users.push(recipient);
    }
    return users;
  }
  async function summary(
    ctx: Context,
    conversation: Conversation,
    membership: Membership,
  ) {
    const active = (await members(ctx, conversation._id)).filter(
      (row) => row.active,
    );
    const participants = await Promise.all(
      active.map(async (row) => displayIdentity(ctx, row.userId)),
    );
    const latest = await ctx.db
      .query("forumPrivateConversationMessages")
      .withIndex("by_conversationId_and_sequence", (q) =>
        q
          .eq("conversationId", conversation._id)
          .gte("sequence", membership.joinedSequence),
      )
      .order("desc")
      .take(1);
    return {
      _id: conversation._id,
      kind: conversation.kind,
      title:
        conversation.title ??
        participants
          .filter((person) => person.userId !== membership.userId)
          .map((person) => person.name)
          .join(", "),
      participants,
      canManage: conversation.managerId === membership.userId,
      archived: membership.archived,
      muted: membership.muted,
      unreadCount: Math.max(
        0,
        conversation.lastSequence - membership.lastReadSequence,
      ),
      lastSequence: conversation.lastSequence,
      preview:
        latest[0]?.body.slice(0, 180) ||
        (latest[0]?.attachments.length
          ? "Attachment"
          : "Start the conversation"),
      updatedAt: conversation.updatedAt,
    };
  }
  async function deliver(
    ctx: MutationCtx,
    conversation: Conversation,
    sender: User,
    body: string,
    inputs: { storageId: Id<"_storage">; filename: string }[] | undefined,
    key: string,
    fingerprint: string,
  ) {
    const active = (await members(ctx, conversation._id)).filter(
      (row) => row.active,
    );
    for (const member of active) {
      if (member.userId === sender._id) continue;
      const recipient = await ctx.db.get("users", member.userId);
      if (!recipient)
        fail(
          "RECIPIENT_NOT_FOUND",
          "A participant is unavailable. Update the group before sending.",
        );
      await access.assertDeliveryAllowed(ctx, sender, recipient);
      const human = await owner(ctx, recipient);
      if (!access.isTrustedForumUser(human))
        fail("RECIPIENT_NOT_FOUND", "A participant is unavailable.");
      await access.assertForumParticipationAllowed(
        ctx,
        recipient,
        "receive private messages",
      );
      await access.assertForumParticipationAllowed(
        ctx,
        human,
        "receive private messages",
      );
    }
    const files = await access.normalizeAttachments(ctx, sender._id, inputs);
    if (!body && !files.length)
      fail("INVALID_INPUT", "Write a message or attach a file.");
    const quota = await limiter.limit(ctx, "privateConversationSend", {
      key: (await owner(ctx, sender))._id,
    });
    if (!quota.ok)
      fail(
        "PRIVATE_MESSAGE_RATE_LIMITED",
        "Sending too quickly. Wait a few seconds and try again.",
      );
    const now = Date.now(),
      sequence = conversation.lastSequence + 1;
    const messageId = await ctx.db.insert("forumPrivateConversationMessages", {
      conversationId: conversation._id,
      authorId: sender._id,
      sequence,
      body,
      attachments: files.map(({ storageId, filename, contentType, size }) => ({
        storageId,
        filename,
        contentType,
        size,
      })),
      requestId: key,
      requestFingerprint: fingerprint,
      agentAssisted: forumPluginPrincipal(ctx) !== null && !sender.isAgent,
      createdAt: now,
    });
    for (const file of files)
      await ctx.db.patch("forumPendingUploads", file.pendingUploadId, {
        status: "consumed",
        consumedAt: now,
        updatedAt: now,
      });
    await ctx.db.patch("forumPrivateConversations", conversation._id, {
      lastSequence: sequence,
      updatedAt: now,
    });
    for (const member of active)
      await ctx.db.patch("forumPrivateConversationMembers", member._id, {
        lastActivityAt: now,
        archived: false,
        ...(member.userId === sender._id ? { lastReadSequence: sequence } : {}),
      });
    return { messageId, sequence };
  }
  const getPrivateMessageAccess = defineForumQuery({
    args: {},
    returns: v.object({ userId: v.id("users"), allowed: v.boolean() }),
    handler: async (ctx) => {
      const user = await access.requireSignedInUser(
        ctx,
        "Sign in to use private conversations.",
      );
      return { userId: user._id, allowed: await canUse(ctx) };
    },
  });
  const listPrivateMessageConversations = defineForumQuery({
    args: {
      archived: v.optional(v.boolean()),
      query: v.optional(v.string()),
      limit: v.optional(v.number()),
    },
    returns: v.object({
      conversations: v.array(conversationValidator),
      limited: v.boolean(),
    }),
    handler: async (ctx, args) => {
      const { user } = await actor(ctx);
      const limit = args.limit ?? 60;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail("INVALID_INPUT", "Use a conversation limit between 1 and 100.");
      const memberships = await ctx.db
        .query("forumPrivateConversationMembers")
        .withIndex(
          "by_userId_and_active_and_archived_and_lastActivityAt",
          (q) =>
            q
              .eq("userId", user._id)
              .eq("active", true)
              .eq("archived", args.archived ?? false),
        )
        .order("desc")
        .take(limit + 1);
      const records = await Promise.all(
        memberships.slice(0, limit).map(async (membership) => {
          const conversation = await ctx.db.get(
            "forumPrivateConversations",
            membership.conversationId,
          );
          return conversation ? summary(ctx, conversation, membership) : null;
        }),
      );
      const query = clean(args.query ?? "", 100, "Search").toLowerCase();
      return {
        conversations: records.filter(
          (row): row is NonNullable<typeof row> =>
            row !== null &&
            (!query ||
              `${row.title} ${row.participants.map((person) => `${person.name} ${person.username}`).join(" ")}`
                .toLowerCase()
                .includes(query)),
        ),
        limited: memberships.length > limit,
      };
    },
  });
  const getPrivateMessageConversation = defineForumQuery({
    args: {
      conversationId: v.id("forumPrivateConversations"),
      beforeSequence: v.optional(v.number()),
    },
    returns: v.union(
      v.null(),
      v.object({
        conversation: conversationValidator,
        viewerId: v.id("users"),
        hasOlder: v.boolean(),
        messages: v.array(
          v.object({
            _id: v.id("forumPrivateConversationMessages"),
            sequence: v.number(),
            body: v.string(),
            author: identityValidator,
            createdAt: v.number(),
            agentAssisted: v.boolean(),
            readBy: v.array(v.string()),
            attachments: v.array(
              v.object({
                storageId: v.id("_storage"),
                filename: v.string(),
                contentType: v.string(),
                size: v.number(),
                url: v.union(v.string(), v.null()),
              }),
            ),
          }),
        ),
      }),
    ),
    handler: async (ctx, args) => {
      const { user } = await actor(ctx);
      const mine = await ctx.db
        .query("forumPrivateConversationMembers")
        .withIndex("by_conversationId_and_userId", (q) =>
          q.eq("conversationId", args.conversationId).eq("userId", user._id),
        )
        .unique();
      if (!mine?.active) return null;
      const { membership, conversation } = await joined(
        ctx,
        args.conversationId,
        user._id,
      );
      const before = args.beforeSequence ?? conversation.lastSequence + 1;
      if (!Number.isInteger(before) || before < 1)
        fail("INVALID_INPUT", "The message cursor is invalid.");
      const rows = await ctx.db
        .query("forumPrivateConversationMessages")
        .withIndex("by_conversationId_and_sequence", (q) =>
          q
            .eq("conversationId", conversation._id)
            .gte("sequence", membership.joinedSequence)
            .lt("sequence", before),
        )
        .order("desc")
        .take(41);
      const people = await summary(ctx, conversation, membership);
      const membershipRows = (await members(ctx, conversation._id)).filter(
        (row) => row.active,
      );
      return {
        conversation: people,
        viewerId: user._id,
        hasOlder: rows.length > 40,
        messages: await Promise.all(
          rows
            .slice(0, 40)
            .reverse()
            .map(async (row) => ({
              _id: row._id,
              sequence: row.sequence,
              body: row.body,
              author: await displayIdentity(ctx, row.authorId),
              createdAt: row.createdAt,
              agentAssisted: row.agentAssisted,
              readBy: membershipRows
                .filter(
                  (member) =>
                    member.userId !== row.authorId &&
                    member.lastReadSequence >= row.sequence &&
                    member.joinedSequence <= row.sequence,
                )
                .map(
                  (member) =>
                    people.participants.find(
                      (person) => person.userId === member.userId,
                    )?.name ?? "Member",
                ),
              attachments: await Promise.all(
                row.attachments.map(async (file) => ({
                  ...file,
                  url: await ctx.storage.getUrl(file.storageId),
                })),
              ),
            })),
        ),
      };
    },
  });
  const listPrivateMessageRecipients = defineForumQuery({
    args: { query: v.optional(v.string()) },
    returns: v.array(identityValidator),
    handler: async (ctx, args) => {
      const { user, human } = await actor(ctx);
      const prefix = clean(
        (args.query ?? "").replace(/^@/, ""),
        60,
        "Handle",
      ).toLowerCase();
      const candidates = await ctx.db
        .query("users")
        .withIndex("by_usernameNormalized", (q) =>
          q
            .gte("usernameNormalized", prefix)
            .lt("usernameNormalized", `${prefix}\uffff`),
        )
        .take(30);
      const result: ReturnType<typeof identity>[] = [];
      for (const candidate of candidates) {
        if (!candidate.username || candidate._id === user._id) continue;
        try {
          const candidateOwner = await owner(ctx, candidate);
          if (
            candidateOwner._id === human._id ||
            !access.isTrustedForumUser(candidateOwner)
          )
            continue;
          await access.assertForumParticipationAllowed(
            ctx,
            candidate,
            "receive private messages",
          );
          await access.assertForumParticipationAllowed(
            ctx,
            candidateOwner,
            "receive private messages",
          );
          await access.assertDeliveryAllowed(ctx, user, candidate);
          result.push(await displayIdentity(ctx, candidate._id, candidate));
        } catch (error) {
          if (!(error instanceof ConvexError)) throw error;
        }
        if (result.length === 8) break;
      }
      return result;
    },
  });
  const createPrivateMessageConversation = defineForumMutation({
    args: {
      recipientUsernames: v.array(v.string()),
      title: v.optional(v.string()),
      body: v.optional(v.string()),
      attachments: v.optional(v.array(attachmentInput)),
      requestId: v.string(),
    },
    returns: v.object({
      conversationId: v.id("forumPrivateConversations"),
      reused: v.boolean(),
      url: v.string(),
    }),
    handler: async (ctx, args) => {
      const { user, human } = await actor(ctx, true);
      const key = requestKey(args.requestId),
        title = clean(args.title ?? "", 100, "Group name"),
        body = clean(args.body ?? "", 20_000, "Message");
      const fingerprint = JSON.stringify([
        args.recipientUsernames
          .map((name) => name.replace(/^@/, "").trim().toLowerCase())
          .sort(),
        title,
        body,
        args.attachments ?? [],
      ]);
      const receipt = await ctx.db
        .query("forumPrivateConversationRequests")
        .withIndex("by_actorId_and_requestId", (q) =>
          q.eq("actorId", user._id).eq("requestId", key),
        )
        .unique();
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          fail(
            "IDEMPOTENCY_CONFLICT",
            "This request ID was already used for a different conversation.",
          );
        await joined(ctx, receipt.conversationId, user._id);
        return {
          conversationId: receipt.conversationId,
          reused: true,
          url: `https://forum.symbaiex.com/messages?conversation=${receipt.conversationId}`,
        };
      }
      const people = await recipients(ctx, user, args.recipientUsernames);
      for (let i = 0; i < people.length; i++)
        for (let j = i + 1; j < people.length; j++) {
          await access.assertDeliveryAllowed(ctx, people[i], people[j]);
          await access.assertDeliveryAllowed(ctx, people[j], people[i]);
        }
      const group = people.length > 1;
      const directKey = group
        ? undefined
        : [user._id, people[0]._id].sort().join(":");
      const existing = directKey
        ? await ctx.db
            .query("forumPrivateConversations")
            .withIndex("by_directKey", (q) => q.eq("directKey", directKey))
            .unique()
        : null;
      if (existing) {
        await joined(ctx, existing._id, user._id);
        if (body || args.attachments?.length)
          await sendPrivateMessageConversation.definition.handler(ctx, {
            conversationId: existing._id,
            body,
            attachments: args.attachments,
            requestId: key,
          });
        else {
          const mine = await joined(ctx, existing._id, user._id);
          await ctx.db.patch(
            "forumPrivateConversationMembers",
            mine.membership._id,
            { archived: false },
          );
        }
        await ctx.db.insert("forumPrivateConversationRequests", {
          actorId: user._id,
          requestId: key,
          fingerprint,
          conversationId: existing._id,
          createdAt: Date.now(),
        });
        return {
          conversationId: existing._id,
          reused: true,
          url: `https://forum.symbaiex.com/messages?conversation=${existing._id}`,
        };
      }
      const quota = await limiter.limit(ctx, "privateConversationStart", {
        key: human._id,
      });
      if (!quota.ok)
        fail(
          "PRIVATE_MESSAGE_RATE_LIMITED",
          "Starting too many conversations. Try an existing chat or wait a little.",
        );
      const now = Date.now();
      const conversationId = await ctx.db.insert("forumPrivateConversations", {
        kind: group ? "group" : "direct",
        ...(group && title ? { title } : {}),
        creatorId: user._id,
        managerId: user._id,
        ...(directKey ? { directKey } : {}),
        requestId: key,
        requestFingerprint: fingerprint,
        lastSequence: 0,
        createdAt: now,
        updatedAt: now,
      });
      for (const person of [user, ...people])
        await ctx.db.insert("forumPrivateConversationMembers", {
          conversationId,
          userId: person._id,
          active: true,
          joinedSequence: 1,
          lastReadSequence: 0,
          archived: false,
          muted: false,
          lastActivityAt: now,
        });
      if (body || args.attachments?.length)
        await deliver(
          ctx,
          (await ctx.db.get("forumPrivateConversations", conversationId))!,
          user,
          body,
          args.attachments,
          key,
          fingerprint,
        );
      await ctx.db.insert("forumPrivateConversationRequests", {
        actorId: user._id,
        requestId: key,
        fingerprint,
        conversationId,
        createdAt: now,
      });
      return {
        conversationId,
        reused: false,
        url: `https://forum.symbaiex.com/messages?conversation=${conversationId}`,
      };
    },
  });
  const sendPrivateMessageConversation = {
    kind: "mutation" as const,
    definition: defineForumMutation({
      args: {
        conversationId: v.id("forumPrivateConversations"),
        body: v.string(),
        attachments: v.optional(v.array(attachmentInput)),
        requestId: v.string(),
      },
      returns: v.object({
        messageId: v.id("forumPrivateConversationMessages"),
        sequence: v.number(),
      }),
      handler: async (ctx, args) => {
        const { user } = await actor(ctx, true);
        const { conversation } = await joined(
          ctx,
          args.conversationId,
          user._id,
        );
        const body = clean(args.body, 20_000, "Message"),
          key = requestKey(args.requestId),
          fingerprint = JSON.stringify([body, args.attachments ?? []]);
        const receipt = await ctx.db
          .query("forumPrivateConversationMessages")
          .withIndex("by_authorId_and_conversationId_and_requestId", (q) =>
            q
              .eq("authorId", user._id)
              .eq("conversationId", conversation._id)
              .eq("requestId", key),
          )
          .unique();
        if (receipt) {
          if (receipt.requestFingerprint !== fingerprint)
            fail(
              "IDEMPOTENCY_CONFLICT",
              "This request ID was already used for another message.",
            );
          return { messageId: receipt._id, sequence: receipt.sequence };
        }
        return deliver(
          ctx,
          conversation,
          user,
          body,
          args.attachments,
          key,
          fingerprint,
        );
      },
    }),
  };
  const setPrivateMessageConversation = defineForumMutation({
    args: {
      conversationId: v.id("forumPrivateConversations"),
      archived: v.optional(v.boolean()),
      muted: v.optional(v.boolean()),
      readThroughSequence: v.optional(v.number()),
      title: v.optional(v.string()),
      addRecipientUsernames: v.optional(v.array(v.string())),
      removeUserId: v.optional(v.id("users")),
      leave: v.optional(v.literal(true)),
    },
    returns: v.object({ updated: v.boolean() }),
    handler: async (ctx, args) => {
      const { user } = await actor(ctx, true);
      const { conversation, membership } = await joined(
        ctx,
        args.conversationId,
        user._id,
      );
      const managing =
        args.title !== undefined ||
        args.addRecipientUsernames !== undefined ||
        args.removeUserId !== undefined;
      if (
        managing &&
        (conversation.kind !== "group" || conversation.managerId !== user._id)
      )
        fail(
          "FORBIDDEN",
          "Only the group organizer can manage participants or rename the group.",
        );
      if (args.title !== undefined) {
        const title = clean(args.title, 100, "Group name");
        if (!title) fail("INVALID_INPUT", "Give the group a name.");
        await ctx.db.patch("forumPrivateConversations", conversation._id, {
          title,
        });
      }
      if (args.addRecipientUsernames?.length) {
        const added = await recipients(ctx, user, args.addRecipientUsernames),
          current = await members(ctx, conversation._id);
        const newPeople = added.filter(
          (person) =>
            !current.some(
              (member) => member.userId === person._id && member.active,
            ),
        );
        if (
          current.filter((member) => member.active).length + newPeople.length >
          MAX_MEMBERS
        )
          fail("GROUP_FULL", "Groups support up to 12 active participants.");
        if (
          current.length +
            newPeople.filter(
              (person) =>
                !current.some((member) => member.userId === person._id),
            ).length >
          MAX_MEMBER_RECORDS
        )
          fail(
            "GROUP_FULL",
            "This group has reached its participant history limit. Start a new group.",
          );
        const activeUsers = await Promise.all(
          current
            .filter((member) => member.active)
            .map((member) => ctx.db.get("users", member.userId)),
        );
        const ownerIds = new Set(
          await Promise.all(
            activeUsers
              .filter((person): person is User => !!person)
              .map(async (person) => (await owner(ctx, person))._id),
          ),
        );
        for (const person of newPeople) {
          if (ownerIds.has((await owner(ctx, person))._id))
            fail(
              "INVALID_RECIPIENT",
              "A profile belonging to that owner is already in the group.",
            );
          for (const participant of activeUsers)
            if (participant) {
              await access.assertDeliveryAllowed(ctx, participant, person);
              await access.assertDeliveryAllowed(ctx, person, participant);
            }
          const returning = current.find(
            (member) => member.userId === person._id,
          );
          const membership = {
            active: true,
            joinedSequence: conversation.lastSequence + 1,
            lastReadSequence: conversation.lastSequence,
            archived: false,
            muted: false,
            lastActivityAt: Date.now(),
          };
          if (returning)
            await ctx.db.patch(
              "forumPrivateConversationMembers",
              returning._id,
              membership,
            );
          else
            await ctx.db.insert("forumPrivateConversationMembers", {
              conversationId: conversation._id,
              userId: person._id,
              ...membership,
            });
        }
      }
      if (args.removeUserId !== undefined) {
        if (args.removeUserId === user._id)
          fail(
            "INVALID_INPUT",
            "Use Leave group to leave your own conversation.",
          );
        const target = (await members(ctx, conversation._id)).find(
          (member) => member.userId === args.removeUserId && member.active,
        );
        if (!target)
          fail(
            "INVALID_RECIPIENT",
            "This participant is no longer in the group.",
          );
        await ctx.db.patch("forumPrivateConversationMembers", target._id, {
          active: false,
        });
      }
      if (args.leave) {
        if (conversation.kind !== "group")
          fail("INVALID_INPUT", "Archive a direct conversation instead.");
        const remaining = (await members(ctx, conversation._id)).filter(
          (member) => member.active && member.userId !== user._id,
        );
        await ctx.db.patch("forumPrivateConversationMembers", membership._id, {
          active: false,
        });
        if (conversation.managerId === user._id && remaining[0])
          await ctx.db.patch("forumPrivateConversations", conversation._id, {
            managerId: remaining[0].userId,
          });
      }
      if (
        args.readThroughSequence !== undefined &&
        (!Number.isInteger(args.readThroughSequence) ||
          args.readThroughSequence < 0 ||
          args.readThroughSequence > conversation.lastSequence)
      )
        fail("INVALID_INPUT", "The read position is invalid.");
      await ctx.db.patch("forumPrivateConversationMembers", membership._id, {
        ...(args.archived !== undefined ? { archived: args.archived } : {}),
        ...(args.muted !== undefined ? { muted: args.muted } : {}),
        ...(args.readThroughSequence !== undefined
          ? {
              lastReadSequence: Math.max(
                membership.lastReadSequence,
                args.readThroughSequence,
              ),
            }
          : {}),
      });
      return { updated: true };
    },
  });
  const reportPrivateMessageConversation = defineForumMutation({
    args: {
      messageId: v.id("forumPrivateConversationMessages"),
      reason: v.string(),
      details: v.optional(v.string()),
    },
    returns: v.object({ reportId: v.id("forumReports"), created: v.boolean() }),
    handler: async (ctx, args) => {
      const { user, human } = await actor(ctx, true);
      const message = await ctx.db.get(
        "forumPrivateConversationMessages",
        args.messageId,
      );
      if (!message || message.authorId === user._id)
        fail(
          "PRIVATE_MESSAGE_NOT_FOUND",
          "This message is unavailable for reporting.",
        );
      const { conversation, membership } = await joined(
        ctx,
        message.conversationId,
        user._id,
      );
      if (message.sequence < membership.joinedSequence)
        fail(
          "PRIVATE_MESSAGE_NOT_FOUND",
          "This message is unavailable for reporting.",
        );
      const reason = clean(args.reason, 300, "Reason"),
        details = clean(args.details ?? "", 2_000, "Details");
      if (reason.length < 3)
        fail("INVALID_INPUT", "Please add a short reason.");
      const existing = await ctx.db
        .query("forumReports")
        .withIndex("by_reporterId_and_status_and_createdAt", (q) =>
          q.eq("reporterId", user._id).eq("status", "open"),
        )
        .take(10);
      const duplicate = existing.find(
        (report) => report.conversationMessageId === message._id,
      );
      if (duplicate) return { reportId: duplicate._id, created: false };
      if (existing.length >= 10)
        fail(
          "REPORT_LIMIT_REACHED",
          "Wait for your existing reports to be reviewed.",
        );
      if (
        !(
          await limiter.limit(ctx, "privateConversationReport", {
            key: human._id,
          })
        ).ok
      )
        fail(
          "REPORT_RATE_LIMITED",
          "Please wait before reporting another message.",
        );
      const now = Date.now(),
        author = await ctx.db.get("users", message.authorId);
      const reportId = await ctx.db.insert("forumReports", {
        reporterId: user._id,
        entityType: "privateMessage",
        conversationMessageId: message._id,
        snapshotTitle: conversation.title ?? "Private conversation",
        snapshotBody: message.body,
        snapshotAuthorId: message.authorId,
        snapshotAuthorName: author?.username ?? "Member",
        snapshotCreatedAt: message.createdAt,
        reason,
        ...(details ? { details } : {}),
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
      await access.recordReport(
        ctx,
        user._id,
        reportId,
        message._id,
        message.authorId,
      );
      return { reportId, created: true };
    },
  });
  async function unreadSummary(ctx: Context, userId: Id<"users">) {
    const rows = await ctx.db
      .query("forumPrivateConversationMembers")
      .withIndex("by_userId_and_active_and_archived_and_lastActivityAt", (q) =>
        q.eq("userId", userId).eq("active", true).eq("archived", false),
      )
      .take(101);
    let unreadCount = 0;
    for (const row of rows.slice(0, 100)) {
      if (row.muted) continue;
      const conversation = await ctx.db.get(
        "forumPrivateConversations",
        row.conversationId,
      );
      if (conversation)
        unreadCount += Math.max(
          0,
          conversation.lastSequence - row.lastReadSequence,
        );
    }
    return { unreadCount, unreadCountLimited: rows.length > 100 };
  }
  async function canUse(ctx: Context) {
    try {
      await actor(ctx);
      return true;
    } catch (error) {
      if (error instanceof ConvexError) return false;
      throw error;
    }
  }
  return {
    canUse,
    unreadSummary,
    operations: {
      getPrivateMessageAccess: {
        kind: "query" as const,
        definition: getPrivateMessageAccess,
      },
      listPrivateMessageConversations: {
        kind: "query" as const,
        definition: listPrivateMessageConversations,
      },
      getPrivateMessageConversation: {
        kind: "query" as const,
        definition: getPrivateMessageConversation,
      },
      listPrivateMessageRecipients: {
        kind: "query" as const,
        definition: listPrivateMessageRecipients,
      },
      createPrivateMessageConversation: {
        kind: "mutation" as const,
        definition: createPrivateMessageConversation,
      },
      sendPrivateMessageConversation,
      setPrivateMessageConversation: {
        kind: "mutation" as const,
        definition: setPrivateMessageConversation,
      },
      reportPrivateMessageConversation: {
        kind: "mutation" as const,
        definition: reportPrivateMessageConversation,
      },
    },
  };
}
