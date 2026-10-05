/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}
async function seed(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const ids = await Promise.all(
      ["alice", "bob", "carol", "drew", "staff"].map((username) =>
        ctx.db.insert("users", {
          username,
          usernameNormalized: username,
          name: username,
          forumTrustedAt: now,
          ...(username === "staff" ? { forumRole: "moderator" as const } : {}),
        }),
      ),
    );
    const agent = await ctx.db.insert("users", {
      username: "alicebot",
      usernameNormalized: "alicebot",
      isAgent: true,
      agentSlug: "alicebot",
      agentStatus: "active",
      agentScopes: ["forum"],
      agentKeyVersion: 1,
    });
    const credential = await ctx.db.insert("agentIdentities", {
      agentId: "alicebot",
      userId: agent,
      ownerUserId: ids[0],
      credentialKind: "oauth",
      scopes: ["forum"],
      status: "active",
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    return {
      alice: ids[0],
      bob: ids[1],
      carol: ids[2],
      drew: ids[3],
      staff: ids[4],
      agent,
      credential,
    };
  });
}
async function ignore(
  t: ReturnType<typeof setup>,
  userId: Id<"users">,
  targetUserId: Id<"users">,
) {
  await t.run((ctx) =>
    ctx.db.insert("forumUserRelationships", {
      userId,
      targetUserId,
      kind: "ignore",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}
async function upload(t: ReturnType<typeof setup>, userId: Id<"users">) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(["image"], { type: "image/png" }),
    );
    await ctx.db.insert("forumPendingUploads", {
      storageId,
      userId,
      filename: "picture.png",
      contentType: "image/png",
      size: 5,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    });
    return { storageId, filename: "picture.png" };
  });
}

describe("private direct and group conversations", () => {
  test("DM pairs reuse one conversation in either direction and exact retries do not duplicate messages", async () => {
    const t = setup(),
      s = await seed(t),
      alice = t.withIdentity({ subject: s.alice }),
      bob = t.withIdentity({ subject: s.bob });
    const args = {
      recipientUsernames: ["bob"],
      body: "Hello Bob",
      requestId: "start",
    };
    const first = await alice.mutation(
      api.forum.createPrivateMessageConversation,
      args,
    );
    expect(
      await alice.mutation(api.forum.createPrivateMessageConversation, args),
    ).toMatchObject({ conversationId: first.conversationId, reused: true });
    const reverse = await bob.mutation(
      api.forum.createPrivateMessageConversation,
      { recipientUsernames: ["alice"], requestId: "reverse" },
    );
    expect(reverse.conversationId).toBe(first.conversationId);
    await expect(
      bob.mutation(api.forum.createPrivateMessageConversation, {
        recipientUsernames: ["carol"],
        requestId: "reverse",
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    const send = {
      conversationId: first.conversationId,
      body: "Hi Alice",
      requestId: "reply",
    };
    const reply = await bob.mutation(
      api.forum.sendPrivateMessageConversation,
      send,
    );
    expect(
      await bob.mutation(api.forum.sendPrivateMessageConversation, send),
    ).toEqual(reply);
    await expect(
      bob.mutation(api.forum.sendPrivateMessageConversation, {
        ...send,
        body: "Changed",
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(
      alice.mutation(api.forum.createPrivateMessageConversation, {
        ...args,
        body: "Changed",
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(
      (
        await alice.query(api.forum.getPrivateMessageConversation, {
          conversationId: first.conversationId,
        })
      )?.messages.map((message) => message.body),
    ).toEqual(["Hello Bob", "Hi Alice"]);
    expect(
      (await alice.query(api.forum.getMyForumNavState, {}))
        .unreadPrivateMessages,
    ).toBe(1);
  });
  test("anonymous, outsiders and staff cannot read or send into somebody else's conversation", async () => {
    const t = setup(),
      s = await seed(t),
      alice = t.withIdentity({ subject: s.alice });
    const { conversationId } = await alice.mutation(
      api.forum.createPrivateMessageConversation,
      {
        recipientUsernames: ["bob", "carol"],
        title: "Builders",
        body: "Private",
        requestId: "group",
      },
    );
    await expect(
      t.query(api.forum.getPrivateMessageConversation, { conversationId }),
    ).rejects.toThrow("Sign in");
    for (const who of [s.drew, s.staff]) {
      const outsider = t.withIdentity({ subject: who });
      expect(
        await outsider.query(api.forum.getPrivateMessageConversation, {
          conversationId,
        }),
      ).toBeNull();
      await expect(
        outsider.mutation(api.forum.sendPrivateMessageConversation, {
          conversationId,
          body: "Intrude",
          requestId: "bad",
        }),
      ).rejects.toThrow("unavailable");
      expect(
        (await outsider.query(api.forum.listPrivateMessageConversations, {}))
          .conversations,
      ).toEqual([]);
    }
  });
  test("new members cannot see earlier history, and only the organizer can add or remove members", async () => {
    const t = setup(),
      s = await seed(t),
      alice = t.withIdentity({ subject: s.alice }),
      bob = t.withIdentity({ subject: s.bob }),
      drew = t.withIdentity({ subject: s.drew });
    const { conversationId } = await alice.mutation(
      api.forum.createPrivateMessageConversation,
      {
        recipientUsernames: ["bob", "carol"],
        body: "Before Drew",
        requestId: "group",
      },
    );
    await expect(
      bob.mutation(api.forum.setPrivateMessageConversation, {
        conversationId,
        addRecipientUsernames: ["drew"],
      }),
    ).rejects.toThrow("organizer");
    await alice.mutation(api.forum.setPrivateMessageConversation, {
      conversationId,
      addRecipientUsernames: ["drew"],
      title: "Builders",
    });
    expect(
      (
        await drew.query(api.forum.getPrivateMessageConversation, {
          conversationId,
        })
      )?.messages,
    ).toEqual([]);
    await alice.mutation(api.forum.sendPrivateMessageConversation, {
      conversationId,
      body: "After Drew",
      requestId: "later",
    });
    const joined = await drew.query(api.forum.getPrivateMessageConversation, {
      conversationId,
    });
    expect(joined?.messages.map((message) => message.body)).toEqual([
      "After Drew",
    ]);
    expect(joined?.conversation.unreadCount).toBe(1);
    await expect(
      bob.mutation(api.forum.setPrivateMessageConversation, {
        conversationId,
        removeUserId: s.drew,
      }),
    ).rejects.toThrow("organizer");
    await alice.mutation(api.forum.setPrivateMessageConversation, {
      conversationId,
      removeUserId: s.drew,
    });
    expect(
      await drew.query(api.forum.getPrivateMessageConversation, {
        conversationId,
      }),
    ).toBeNull();
    await expect(
      drew.mutation(api.forum.sendPrivateMessageConversation, {
        conversationId,
        body: "Removed",
        requestId: "removed",
      }),
    ).rejects.toThrow("unavailable");
  });
  test("leaving revokes access and transfers group management without changing creator retry identity", async () => {
    const t = setup(),
      s = await seed(t),
      alice = t.withIdentity({ subject: s.alice });
    const { conversationId } = await alice.mutation(
      api.forum.createPrivateMessageConversation,
      { recipientUsernames: ["bob", "carol"], requestId: "group" },
    );
    await alice.mutation(api.forum.setPrivateMessageConversation, {
      conversationId,
      leave: true,
    });
    expect(
      await alice.query(api.forum.getPrivateMessageConversation, {
        conversationId,
      }),
    ).toBeNull();
    const manager = await t.run((ctx) =>
      ctx.db.get("forumPrivateConversations", conversationId),
    );
    expect(manager?.creatorId).toBe(s.alice);
    expect(manager?.managerId).not.toBe(s.alice);
    await t
      .withIdentity({ subject: manager!.managerId })
      .mutation(api.forum.setPrivateMessageConversation, {
        conversationId,
        title: "New organizer",
      });
  });
  test("read markers are monotonic, mute suppresses nav count, archived chats revive on incoming messages", async () => {
    const t = setup(),
      s = await seed(t),
      alice = t.withIdentity({ subject: s.alice }),
      bob = t.withIdentity({ subject: s.bob });
    const { conversationId } = await alice.mutation(
      api.forum.createPrivateMessageConversation,
      { recipientUsernames: ["bob"], body: "Hello", requestId: "direct" },
    );
    expect(
      (await bob.query(api.forum.getMyForumNavState, {})).unreadPrivateMessages,
    ).toBe(1);
    await bob.mutation(api.forum.setPrivateMessageConversation, {
      conversationId,
      muted: true,
    });
    expect(
      (await bob.query(api.forum.getMyForumNavState, {})).unreadPrivateMessages,
    ).toBe(0);
    await bob.mutation(api.forum.setPrivateMessageConversation, {
      conversationId,
      readThroughSequence: 1,
      archived: true,
    });
    await bob.mutation(api.forum.setPrivateMessageConversation, {
      conversationId,
      readThroughSequence: 0,
    });
    expect(
      (
        await bob.query(api.forum.getPrivateMessageConversation, {
          conversationId,
        })
      )?.conversation.unreadCount,
    ).toBe(0);
    expect(
      (await bob.query(api.forum.listPrivateMessageConversations, {}))
        .conversations,
    ).toEqual([]);
    expect(
      (
        await bob.query(api.forum.listPrivateMessageConversations, {
          archived: true,
        })
      ).conversations,
    ).toHaveLength(1);
    await expect(
      bob.mutation(api.forum.setPrivateMessageConversation, {
        conversationId,
        readThroughSequence: 99,
      }),
    ).rejects.toThrow("invalid");
    await alice.mutation(api.forum.sendPrivateMessageConversation, {
      conversationId,
      body: "Again",
      requestId: "again",
    });
    expect(
      (await bob.query(api.forum.listPrivateMessageConversations, {}))
        .conversations[0],
    ).toMatchObject({ archived: false, muted: true, unreadCount: 1 });
  });
  test("recipient blocks apply across owners' profiles and pairwise within new groups", async () => {
    const t = setup(),
      s = await seed(t),
      alice = t.withIdentity({ subject: s.alice });
    await ignore(t, s.bob, s.carol);
    await expect(
      alice.mutation(api.forum.createPrivateMessageConversation, {
        recipientUsernames: ["bob", "carol"],
        requestId: "blocked-group",
      }),
    ).rejects.toThrow();
    const { conversationId } = await alice.mutation(
      api.forum.createPrivateMessageConversation,
      { recipientUsernames: ["bob"], requestId: "direct" },
    );
    await ignore(t, s.bob, s.agent);
    await expect(
      alice.mutation(api.forum.sendPrivateMessageConversation, {
        conversationId,
        body: "Blocked",
        requestId: "blocked",
      }),
    ).rejects.toThrow();
    expect(
      await alice.query(api.forum.listPrivateMessageRecipients, {
        query: "bo",
      }),
    ).toEqual([]);
    await expect(
      alice.mutation(api.forum.createPrivateMessageConversation, {
        recipientUsernames: ["alicebot"],
        requestId: "self",
      }),
    ).rejects.toThrow("different owners");
  });
  test.each(["alice", "agent"] as const)(
    "owned agent state remains separate and current %s restriction prevents sends",
    async (who) => {
      const t = setup(),
        s = await seed(t),
        agent = t.withIdentity({ subject: s.agent }),
        alice = t.withIdentity({ subject: s.alice });
      const { conversationId } = await agent.mutation(
        api.forum.createPrivateMessageConversation,
        {
          recipientUsernames: ["bob"],
          body: "From agent",
          requestId: "agent-direct",
        },
      );
      expect(
        (
          await agent.query(api.forum.getPrivateMessageConversation, {
            conversationId,
          })
        )?.messages[0].author.isAgent,
      ).toBe(true);
      expect(
        await alice.query(api.forum.getPrivateMessageConversation, {
          conversationId,
        }),
      ).toBeNull();
      await t.run((ctx) =>
        ctx.db.patch("users", s[who], { forumBannedAt: Date.now() }),
      );
      await expect(
        agent.mutation(api.forum.sendPrivateMessageConversation, {
          conversationId,
          body: "Restricted",
          requestId: "restricted",
        }),
      ).rejects.toThrow();
    },
  );
  test("revoked owner trust cannot be bypassed with a trusted agent or revoked credential", async () => {
    const t = setup(),
      s = await seed(t),
      agent = t.withIdentity({ subject: s.agent });
    await t.run(async (ctx) => {
      await ctx.db.patch("users", s.alice, { forumTrustRevokedAt: Date.now() });
      await ctx.db.patch("users", s.agent, { forumTrustedAt: Date.now() });
    });
    await expect(
      agent.query(api.forum.listPrivateMessageConversations, {}),
    ).rejects.toThrow("owner");
    await t.run(async (ctx) => {
      await ctx.db.patch("users", s.alice, { forumTrustRevokedAt: undefined });
      await ctx.db.patch("agentIdentities", s.credential, {
        status: "revoked",
      });
    });
    await expect(
      agent.query(api.forum.listPrivateMessageConversations, {}),
    ).rejects.toThrow("active owned");
  });
  test("attachments are actor-owned, consumed atomically, and retries replay the receipt", async () => {
    const t = setup(),
      s = await seed(t),
      alice = t.withIdentity({ subject: s.alice }),
      bob = t.withIdentity({ subject: s.bob });
    const { conversationId } = await alice.mutation(
      api.forum.createPrivateMessageConversation,
      { recipientUsernames: ["bob"], requestId: "direct" },
    );
    const file = await upload(t, s.bob);
    await expect(
      alice.mutation(api.forum.sendPrivateMessageConversation, {
        conversationId,
        body: "",
        attachments: [file],
        requestId: "stolen",
      }),
    ).rejects.toThrow("attachment");
    const args = {
      conversationId,
      body: "",
      attachments: [file],
      requestId: "photo",
    };
    const sent = await bob.mutation(
      api.forum.sendPrivateMessageConversation,
      args,
    );
    expect(
      await bob.mutation(api.forum.sendPrivateMessageConversation, args),
    ).toEqual(sent);
    const message = (
      await alice.query(api.forum.getPrivateMessageConversation, {
        conversationId,
      })
    )?.messages[0];
    expect(message?.attachments[0]).toMatchObject({
      filename: "picture.png",
      contentType: "image/png",
      size: 5,
    });
    expect(message?.attachments[0].url).toBeTruthy();
    await expect(
      bob.mutation(api.forum.sendPrivateMessageConversation, {
        ...args,
        requestId: "reuse",
      }),
    ).rejects.toThrow("attachment");
    await expect(
      alice.mutation(api.forum.sendPrivateMessageConversation, {
        ...args,
        attachments: Array(6).fill(file),
        requestId: "too-many",
      }),
    ).rejects.toThrow("5");
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.get("forumPrivateConversationMessages", sent.messageId))
          ?.attachments[0],
      ).not.toHaveProperty("url");
    });
  });
  test("reports expose only the selected incoming message snapshot and record an audit event", async () => {
    const t = setup(),
      s = await seed(t),
      alice = t.withIdentity({ subject: s.alice }),
      bob = t.withIdentity({ subject: s.bob });
    const { conversationId } = await alice.mutation(
      api.forum.createPrivateMessageConversation,
      {
        recipientUsernames: ["bob"],
        body: "Reported content",
        requestId: "direct",
      },
    );
    const messageId = (await bob.query(
      api.forum.getPrivateMessageConversation,
      { conversationId },
    ))!.messages[0]._id;
    await expect(
      alice.mutation(api.forum.reportPrivateMessageConversation, {
        messageId,
        reason: "My own message",
      }),
    ).rejects.toThrow("unavailable");
    await expect(
      t
        .withIdentity({ subject: s.staff })
        .mutation(api.forum.reportPrivateMessageConversation, {
          messageId,
          reason: "Not a participant",
        }),
    ).rejects.toThrow("unavailable");
    const report = await bob.mutation(
      api.forum.reportPrivateMessageConversation,
      { messageId, reason: "Harassment" },
    );
    expect(
      await bob.mutation(api.forum.reportPrivateMessageConversation, {
        messageId,
        reason: "Harassment",
      }),
    ).toMatchObject({ reportId: report.reportId, created: false });
    await t.run(async (ctx) => {
      expect(await ctx.db.get("forumReports", report.reportId)).toMatchObject({
        entityType: "privateMessage",
        conversationMessageId: messageId,
        snapshotBody: "Reported content",
        snapshotAuthorId: s.alice,
      });
      expect(
        await ctx.db
          .query("forumModerationEvents")
          .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
            q.eq("entityType", "forumReport").eq("entityId", report.reportId),
          )
          .take(2),
      ).toHaveLength(1);
    });
  });
  test("rapid retries do not consume chat send capacity and sends have only a brief spam limit", async () => {
    const t = setup(),
      s = await seed(t),
      alice = t.withIdentity({ subject: s.alice });
    const { conversationId } = await alice.mutation(
      api.forum.createPrivateMessageConversation,
      { recipientUsernames: ["bob"], requestId: "direct" },
    );
    for (let i = 0; i < 6; i++) {
      const args = {
        conversationId,
        body: `Message ${i}`,
        requestId: `send-${i}`,
      };
      await alice.mutation(api.forum.sendPrivateMessageConversation, args);
      await alice.mutation(api.forum.sendPrivateMessageConversation, args);
    }
    await expect(
      alice.mutation(api.forum.sendPrivateMessageConversation, {
        conversationId,
        body: "Too fast",
        requestId: "spam",
      }),
    ).rejects.toThrow("few seconds");
    expect(
      (
        await alice.query(api.forum.getPrivateMessageConversation, {
          conversationId,
        })
      )?.messages,
    ).toHaveLength(6);
  });
});

test("returning group members start at their new join position without recovering old history", async () => {
  const t = setup(),
    s = await seed(t),
    alice = t.withIdentity({ subject: s.alice }),
    drew = t.withIdentity({ subject: s.drew });
  const { conversationId } = await alice.mutation(
    api.forum.createPrivateMessageConversation,
    {
      recipientUsernames: ["bob", "drew"],
      body: "Original history",
      requestId: "group",
    },
  );
  await drew.mutation(api.forum.setPrivateMessageConversation, {
    conversationId,
    leave: true,
  });
  await alice.mutation(api.forum.sendPrivateMessageConversation, {
    conversationId,
    body: "While Drew was away",
    requestId: "away",
  });
  await alice.mutation(api.forum.setPrivateMessageConversation, {
    conversationId,
    addRecipientUsernames: ["drew"],
  });
  expect(
    (
      await drew.query(api.forum.getPrivateMessageConversation, {
        conversationId,
      })
    )?.messages,
  ).toEqual([]);
  await alice.mutation(api.forum.sendPrivateMessageConversation, {
    conversationId,
    body: "Welcome back",
    requestId: "back",
  });
  expect(
    (
      await drew.query(api.forum.getPrivateMessageConversation, {
        conversationId,
      })
    )?.messages.map((message) => message.body),
  ).toEqual(["Welcome back"]);
});
test("owner-backed agent access is available without copying trust onto the agent", async () => {
  const t = setup(),
    s = await seed(t),
    agent = t.withIdentity({ subject: s.agent });
  expect(await agent.query(api.forum.getPrivateMessageAccess, {})).toEqual({
    userId: s.agent,
    allowed: true,
  });
  await t.run((ctx) =>
    ctx.db.patch("users", s.alice, { forumTrustRevokedAt: Date.now() }),
  );
  expect(await agent.query(api.forum.getPrivateMessageAccess, {})).toEqual({
    userId: s.agent,
    allowed: false,
  });
});

test("history pages remain bounded and do not mark unseen messages read", async () => {
  const t = setup(),
    s = await seed(t),
    alice = t.withIdentity({ subject: s.alice }),
    bob = t.withIdentity({ subject: s.bob });
  const { conversationId } = await alice.mutation(
    api.forum.createPrivateMessageConversation,
    { recipientUsernames: ["bob"], requestId: "history" },
  );
  await t.run(async (ctx) => {
    for (let sequence = 1; sequence <= 65; sequence++)
      await ctx.db.insert("forumPrivateConversationMessages", {
        conversationId,
        authorId: s.alice,
        sequence,
        body: `Message ${sequence}`,
        attachments: [],
        requestId: `message-${sequence}`,
        requestFingerprint: "fixture",
        agentAssisted: false,
        createdAt: Date.now() + sequence,
      });
    await ctx.db.patch("forumPrivateConversations", conversationId, {
      lastSequence: 65,
    });
  });
  const latest = await bob.query(api.forum.getPrivateMessageConversation, {
    conversationId,
  });
  expect(latest?.messages.map((message) => message.sequence)).toEqual(
    Array.from({ length: 40 }, (_, i) => i + 26),
  );
  expect(latest?.hasOlder).toBe(true);
  const older = await bob.query(api.forum.getPrivateMessageConversation, {
    conversationId,
    beforeSequence: 26,
  });
  expect(older?.messages).toHaveLength(25);
  expect(older?.hasOlder).toBe(false);
  await bob.mutation(api.forum.setPrivateMessageConversation, {
    conversationId,
    readThroughSequence: 25,
  });
  expect(
    (
      await bob.query(api.forum.getPrivateMessageConversation, {
        conversationId,
      })
    )?.conversation.unreadCount,
  ).toBe(40);
});

test("owned agent attachment admission follows current owner trust without touching evidence quota", async () => {
  const t = setup(),
    s = await seed(t),
    agent = t.withIdentity({ subject: s.agent });
  expect(
    await agent.query(internal.forum.authorizeForumAttachmentUpload, {}),
  ).toEqual({ ok: true });
  await t.run((ctx) =>
    ctx.db.patch("users", s.alice, { forumTrustRevokedAt: Date.now() }),
  );
  await expect(
    agent.query(internal.forum.authorizeForumAttachmentUpload, {}),
  ).rejects.toThrow("approve your forum access");
});

test("bounded navigation unread counts include the most recently active conversations", async () => {
  const t = setup(),
    s = await seed(t);
  await t.run(async (ctx) => {
    for (let index = 0; index < 101; index++) {
      const conversationId = await ctx.db.insert("forumPrivateConversations", {
        kind: "group",
        title: `Group ${index}`,
        creatorId: s.alice,
        managerId: s.alice,
        requestId: `seed-${index}`,
        requestFingerprint: `seed-${index}`,
        lastSequence: index === 100 ? 1 : 0,
        createdAt: index,
        updatedAt: index,
      });
      await ctx.db.insert("forumPrivateConversationMembers", {
        conversationId,
        userId: s.alice,
        active: true,
        joinedSequence: 1,
        lastReadSequence: 0,
        archived: false,
        muted: false,
        lastActivityAt: index,
      });
    }
  });
  expect(
    await t
      .withIdentity({ subject: s.alice })
      .query(api.forum.getMyForumNavState, {}),
  ).toMatchObject({
    unreadPrivateMessages: 1,
    unreadPrivateMessagesLimited: true,
  });
});
