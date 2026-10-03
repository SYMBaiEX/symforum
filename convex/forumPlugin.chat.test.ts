/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import agentTest from "@convex-dev/agent/test";
import presenceTest from "@convex-dev/presence/test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const execute = makeFunctionReference<"mutation">("forumPlugin:execute");
const read = makeFunctionReference<"mutation">("forumPlugin:read");
const approve = makeFunctionReference<"mutation">("forumPlugin:approveCommand");
const listCommands = makeFunctionReference<"query">("forumPlugin:listCommands");

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  agentTest.register(t);
  presenceTest.register(t);
  return t;
}

async function fixture(
  t: ReturnType<typeof setup>,
  mode: "human" | "agent" = "agent",
  review = false,
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", {
      username: "chat-owner",
      usernameNormalized: "chat-owner",
      forumTrustedAt: now,
    });
    const stranger = await ctx.db.insert("users", {
      username: "chat-stranger",
      usernameNormalized: "chat-stranger",
      forumTrustedAt: now,
    });
    const agent = await ctx.db.insert("users", {
      username: "chat-helper",
      usernameNormalized: "chat-helper",
      role: "reader",
      isAgent: true,
      agentSlug: "chat-helper",
      agentStatus: "active",
      agentScopes: ["forum"],
      agentKeyVersion: 1,
    });
    const credential = await ctx.db.insert("agentIdentities", {
      agentId: "chat-helper",
      userId: agent,
      ownerUserId: owner,
      credentialKind: "oauth",
      scopes: ["forum"],
      status: "active",
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const connectionId = await ctx.db.insert("forumPluginConnections", {
      ownerUserId: owner,
      credentialAgentIdentityId: credential,
      actorUserId: mode === "human" ? owner : agent,
      actorMode: mode,
      transport: "browser",
      kind: "forum-plugin",
      resource: "https://www.symbaiex.com/api/plugin/mcp",
      issuer: "https://convex.test",
      keyVersion: 1,
      capabilities: ["read", "participate", "moderate"],
      capabilityCeiling: ["read", "participate", "moderate"],
      executionMode: review ? "review" : "direct",
      policyVersion: 1,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const board = await ctx.db.insert("forumCategories", {
      slug: "general",
      name: "General",
      description: "Community chat board",
      kind: "board",
      status: "active",
      viewAccess: "public",
      threadAccess: "members",
      replyAccess: "members",
      pollAccess: "trusted",
      position: 1,
      threadCount: 0,
      postCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { owner, stranger, agent, credential, connectionId, board };
  });
}

function write(
  seed: Awaited<ReturnType<typeof fixture>>,
  operation: string,
  args: Record<string, unknown>,
  idempotencyKey = "chat-command-1",
) {
  return {
    connectionId: seed.connectionId,
    expectedPolicyVersion: 1,
    operation,
    args,
    idempotencyKey,
  };
}

const pageArgs = { paginationOpts: { numItems: 20, cursor: null } };
function readInput(
  seed: Awaited<ReturnType<typeof fixture>>,
  operation: string,
) {
  return {
    connectionId: seed.connectionId,
    expectedPolicyVersion: 1,
    operation,
    args: pageArgs,
  };
}

describe("forum plugin live chat integration", () => {
  test.each(["human", "agent"] as const)(
    "publishes as %s without monthly charges and preserves exact retry receipts",
    async (mode) => {
      const t = setup();
      const seed = await fixture(t, mode);
      const owner = t.withIdentity({ subject: seed.owner });
      const input = write(seed, "sendChatMessage", {
        body: "Hello from the connected forum profile.",
      });
      const first = await owner.mutation(execute, input);
      expect(first).toMatchObject({
        status: "completed",
        publicationStatus: "published",
        url: "https://forum.symbaiex.com/#forum-chat",
        actingAs: {
          userId: mode === "human" ? seed.owner : seed.agent,
          isAgent: mode === "agent",
        },
        data: { status: "active" },
      });
      expect(await owner.mutation(execute, input)).toEqual(first);
      await expect(
        owner.mutation(execute, {
          ...input,
          args: { body: "A different action must use a different key." },
        }),
      ).rejects.toThrow("different command");
      await t.run(async (ctx) => {
        const messages = await ctx.db.query("forumChatMessages").collect();
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
          authorId: mode === "human" ? seed.owner : seed.agent,
          ownerUserId: seed.owner,
          status: "active",
          agentAssisted: true,
        });
        expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
        expect(await ctx.db.query("agentQuotaBudgets").collect()).toHaveLength(
          0,
        );
        expect(
          await ctx.db.query("agentQuotaUsageCounters").collect(),
        ).toHaveLength(0);
        expect(
          (await ctx.db.get("users", seed.agent))?.forumRole,
        ).toBeUndefined();
      });
      const visible = await owner.mutation(
        read,
        readInput(seed, "listChatMessages"),
      );
      expect(visible.data.page).toHaveLength(1);
      expect(visible.data.viewer.actingAs.userId).toBe(
        mode === "human" ? seed.owner : seed.agent,
      );
      const deleted = await owner.mutation(
        execute,
        write(
          seed,
          "deleteChatMessage",
          { messageId: first.data.messageId },
          "chat-delete-1",
        ),
      );
      expect(deleted.status).toBe("completed");
      expect(
        await owner.mutation(
          execute,
          write(
            seed,
            "deleteChatMessage",
            { messageId: first.data.messageId },
            "chat-delete-1",
          ),
        ),
      ).toEqual(deleted);
      const publicView = await t.mutation(read, {
        operation: "listChatMessages",
        args: pageArgs,
      });
      expect(publicView.data.page).toEqual([]);
      expect(publicView.data.pending).toEqual([]);
      await t.run(async (ctx) => {
        expect(
          (await ctx.db.get("forumChatMessages", first.data.messageId))?.status,
        ).toBe("deleted");
        expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
      });
    },
  );

  test.each(["human", "agent"] as const)(
    "enforces owner and credential/profile restrictions in %s mode before writes",
    async (mode) => {
      for (const [restricted, restriction] of [
        ["owner", "ban"],
        ["owner", "suspension"],
        ["agent", "ban"],
        ["agent", "suspension"],
      ] as const) {
        const t = setup();
        const seed = await fixture(t, mode);
        await t.run(async (ctx) => {
          await ctx.db.patch(
            "users",
            seed[restricted],
            restriction === "ban"
              ? { forumBannedAt: Date.now() }
              : { forumSuspendedUntil: Date.now() + 60_000 },
          );
        });
        const owner = t.withIdentity({ subject: seed.owner });
        await expect(
          owner.mutation(
            execute,
            write(seed, "sendChatMessage", {
              body: "A restricted profile cannot post.",
            }),
          ),
        ).rejects.toThrow(/restricted/);
        await expect(
          owner.mutation(read, readInput(seed, "listChatMessages")),
        ).rejects.toThrow(/restricted/);
        await t.run(async (ctx) => {
          expect(await ctx.db.query("forumChatMessages").collect()).toEqual([]);
          expect(await ctx.db.query("forumPluginCommands").collect()).toEqual(
            [],
          );
          expect(await ctx.db.query("agentQuotaUsage").collect()).toEqual([]);
        });
      }
    },
  );

  test.each(["owner", "credential"] as const)(
    "publishes chat despite exhausted %s evidence budgets in both acting modes",
    async (quota) => {
      for (const mode of ["human", "agent"] as const) {
        const t = setup();
        const seed = await fixture(t, mode);
        await t.run(async (ctx) => {
          const now = Date.now();
          if (quota === "owner")
            await ctx.db.insert("agentQuotaBudgets", {
              ownerUserId: seed.owner,
              monthKey: new Date(now).toISOString().slice(0, 7),
              freeAllowanceUnits: 0,
              hardCapUnits: 0,
              usedUnits: 0,
              hardCapMetadataJson: "{}",
              createdAt: now,
              updatedAt: now,
            });
          else
            await ctx.db.insert("agentQuotaLimits", {
              ownerUserId: seed.owner,
              agentId: "chat-helper",
              monthlyLimitUnits: 0,
              requestLimitUnits: 25,
              updatedAt: now,
            });
        });
        expect(
          (
            await t
              .withIdentity({ subject: seed.owner })
              .mutation(
                execute,
                write(seed, "sendChatMessage", {
                  body: "Forum participation remains available.",
                }),
              )
          ).publicationStatus,
        ).toBe("published");
        await t.run(async (ctx) => {
          expect(
            await ctx.db.query("forumChatMessages").collect(),
          ).toHaveLength(1);
          expect(
            await ctx.db.query("forumPluginCommands").collect(),
          ).toHaveLength(1);
          expect(await ctx.db.query("agentQuotaUsage").collect()).toEqual([]);
        });
      }
    },
  );

  test("current board visibility, ancestor visibility and reply permissions govern delegated chat", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", seed.board, {
        replyAccess: "staff",
      });
    });
    await expect(
      owner.mutation(
        execute,
        write(seed, "sendChatMessage", {
          body: "Members cannot post into a staff-only room.",
        }),
      ),
    ).rejects.toThrow(/permission|access|staff/i);
    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", seed.board, {
        replyAccess: "members",
        viewAccess: "staff",
      });
      await ctx.db.insert("forumChatMessages", {
        categoryId: seed.board,
        authorId: seed.stranger,
        ownerUserId: seed.stranger,
        body: "Private staff-board content must not be returned.",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const unavailable = await owner.mutation(
      read,
      readInput(seed, "listChatMessages"),
    );
    expect(unavailable.data).toMatchObject({
      page: [],
      pending: [],
      viewer: { canRead: false, canSend: false, canModerate: false },
    });
    await expect(
      owner.mutation(
        execute,
        write(seed, "sendChatMessage", { body: "Invisible room" }),
      ),
    ).rejects.toThrow(/available|access|staff/i);
    await t.run(async (ctx) => {
      const parent = await ctx.db.insert("forumCategories", {
        slug: "staff-parent",
        name: "Staff parent",
        description: "Hidden path",
        kind: "section",
        status: "active",
        viewAccess: "staff",
        position: 0,
        threadCount: 0,
        postCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.patch("forumCategories", seed.board, {
        viewAccess: "public",
        parentCategoryId: parent,
      });
    });
    await expect(
      owner.mutation(
        execute,
        write(seed, "sendChatMessage", {
          body: "A public leaf cannot bypass its restricted parent.",
        }),
      ),
    ).rejects.toThrow(/available|access|staff/i);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumChatMessages").collect()).toHaveLength(1);
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
      expect(await ctx.db.query("forumPluginCommands").collect()).toEqual([]);
    });
  });

  test.each(["human", "agent"] as const)(
    "moderated %s messages have actionable receipts without leaking to public or foreign readers",
    async (mode) => {
      const t = setup();
      const seed = await fixture(t, mode);
      const owner = t.withIdentity({ subject: seed.owner });
      await t.run(async (ctx) => {
        await ctx.db.patch("users", seed.owner, {
          forumTrustedAt: undefined,
          forumTrustRevokedAt: Date.now(),
        });
      });
      const sent = await owner.mutation(
        execute,
        write(seed, "sendChatMessage", {
          body: "Only this profile and authorized staff may see this pending content.",
        }),
      );
      expect(sent).toMatchObject({
        status: "completed",
        publicationStatus: "pending_moderation",
        data: { status: "pending" },
        url: "https://forum.symbaiex.com/#forum-chat",
      });
      expect(sent.message).toMatch(/not published|not public|moderation/i);
      expect(sent.pendingContentUrl).toMatch(
        /^https:\/\/forum\.symbaiex\.com\//,
      );
      const publicView = await t.mutation(read, {
        operation: "listChatMessages",
        args: pageArgs,
      });
      expect(publicView.data.page).toEqual([]);
      expect(publicView.data.pending).toEqual([]);
      const ownView = await owner.mutation(
        read,
        readInput(seed, "listChatMessages"),
      );
      expect(
        ownView.data.pending.map((message: { _id: string }) => message._id),
      ).toContain(sent.data.messageId);
      const foreign = await t
        .withIdentity({ subject: seed.stranger })
        .mutation(read, { operation: "listChatMessages", args: pageArgs });
      expect(foreign.data.page).toEqual([]);
      expect(foreign.data.pending).toEqual([]);
      await expect(
        owner.mutation(read, readInput(seed, "listChatPendingMessages")),
      ).rejects.toThrow(/permit moderate|moderator|moderation/i);
    },
  );

  test("moderation requires explicit delegation and current General board authority without copying roles to agents", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    const sent = await owner.mutation(
      execute,
      write(seed, "sendChatMessage", { body: "A moderation permission test." }),
    );
    await t.run(async (ctx) => {
      const now = Date.now();
      const otherBoard = await ctx.db.insert("forumCategories", {
        slug: "another-board",
        name: "Another board",
        description: "A separate moderator assignment",
        kind: "board",
        status: "active",
        viewAccess: "public",
        position: 2,
        threadCount: 0,
        postCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("forumCategoryModerators", {
        categoryId: otherBoard,
        userId: seed.owner,
        assignedBy: seed.stranger,
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      owner.mutation(
        execute,
        write(
          seed,
          "moderateChatMessage",
          { messageId: sent.data.messageId, status: "hidden" },
          "chat-hide",
        ),
      ),
    ).rejects.toThrow(/permit moderate|moderator|moderation/i);
    await t.run(async (ctx) => {
      await ctx.db.insert("forumCategoryModerators", {
        categoryId: seed.board,
        userId: seed.owner,
        assignedBy: seed.stranger,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.patch("forumPluginConnections", seed.connectionId, {
        capabilities: ["read", "participate"],
      });
    });
    await expect(
      owner.mutation(
        execute,
        write(
          seed,
          "moderateChatMessage",
          { messageId: sent.data.messageId, status: "hidden" },
          "chat-hide",
        ),
      ),
    ).rejects.toThrow(/permit moderate/);
    await t.run(async (ctx) => {
      await ctx.db.patch("forumPluginConnections", seed.connectionId, {
        capabilities: ["read", "participate", "moderate"],
      });
    });
    await owner.mutation(
      execute,
      write(
        seed,
        "moderateChatMessage",
        { messageId: sent.data.messageId, status: "hidden" },
        "chat-hide",
      ),
    );
    const pending = await owner.mutation(
      read,
      readInput(seed, "listChatPendingMessages"),
    );
    expect(pending.status).toBe("completed");
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.get("forumChatMessages", sent.data.messageId))?.status,
      ).toBe("hidden");
      expect(
        (await ctx.db.get("users", seed.agent))?.forumRole,
      ).toBeUndefined();
      const assignment = await ctx.db
        .query("forumCategoryModerators")
        .withIndex("by_categoryId_and_userId", (q) =>
          q.eq("categoryId", seed.board).eq("userId", seed.owner),
        )
        .unique();
      await ctx.db.delete("forumCategoryModerators", assignment!._id);
    });
    await expect(
      owner.mutation(
        execute,
        write(
          seed,
          "moderateChatMessage",
          { messageId: sent.data.messageId, status: "active" },
          "chat-restore",
        ),
      ),
    ).rejects.toThrow(/permit moderate|moderator|moderation/i);
  });

  test("delegated authors cannot delete another member's chat without current board moderation rights", async () => {
    const t = setup();
    const seed = await fixture(t);
    const foreignId = await t.run(async (ctx) =>
      ctx.db.insert("forumChatMessages", {
        categoryId: seed.board,
        authorId: seed.stranger,
        ownerUserId: seed.stranger,
        body: "Another member's live message.",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      t
        .withIdentity({ subject: seed.owner })
        .mutation(
          execute,
          write(seed, "deleteChatMessage", { messageId: foreignId }),
        ),
    ).rejects.toThrow(/own|delete|permission|author|moderator/i);
    await t.run(async (ctx) => {
      expect((await ctx.db.get("forumChatMessages", foreignId))?.status).toBe(
        "active",
      );
      expect(await ctx.db.query("forumPluginCommands").collect()).toEqual([]);
      expect(await ctx.db.query("agentQuotaUsage").collect()).toEqual([]);
    });
  });

  test("reviewed chat moderation invalidates when its exact target changes before approval", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    const sent = await owner.mutation(
      execute,
      write(seed, "sendChatMessage", {
        body: "This message has an immutable moderation target.",
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("forumCategoryModerators", {
        categoryId: seed.board,
        userId: seed.owner,
        assignedBy: seed.stranger,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.patch("forumPluginConnections", seed.connectionId, {
        executionMode: "review",
        policyVersion: 2,
      });
    });
    const proposal = await owner.mutation(execute, {
      ...write(
        seed,
        "moderateChatMessage",
        { messageId: sent.data.messageId, status: "hidden" },
        "chat-moderation-review",
      ),
      expectedPolicyVersion: 2,
    });
    expect(proposal.status).toBe("pending_approval");
    await t.run(async (ctx) => {
      await ctx.db.patch("forumChatMessages", sent.data.messageId, {
        status: "deleted",
        updatedAt: Date.now() + 1,
      });
    });
    const approved = await owner.mutation(approve, {
      commandId: proposal.commandId,
    });
    expect(approved.data).toMatchObject({
      state: "invalidated",
      reason: "target_changed",
    });
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.get("forumChatMessages", sent.data.messageId))?.status,
      ).toBe("deleted");
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
  });

  test.each(["human", "agent"] as const)(
    "Require review defers %s chat, allows only human-owner approval, and executes once",
    async (mode) => {
      const t = setup();
      const seed = await fixture(t, mode, true);
      const owner = t.withIdentity({ subject: seed.owner });
      const input = write(seed, "sendChatMessage", {
        body: "An immutable chat proposal.",
      });
      const proposal = await owner.mutation(execute, input);
      expect(proposal.status).toBe("pending_approval");
      expect(proposal.approvalUrl).toContain("#review-queue");
      expect(await owner.mutation(execute, input)).toEqual(proposal);
      await t.run(async (ctx) => {
        expect(await ctx.db.query("forumChatMessages").collect()).toEqual([]);
        expect(await ctx.db.query("agentQuotaUsage").collect()).toEqual([]);
      });
      await expect(
        t
          .withIdentity({ subject: seed.agent })
          .mutation(approve, { commandId: proposal.commandId }),
      ).rejects.toThrow("human account");
      await expect(
        t
          .withIdentity({ subject: seed.stranger })
          .mutation(approve, { commandId: proposal.commandId }),
      ).rejects.toThrow("not found");
      const approved = await owner.mutation(approve, {
        commandId: proposal.commandId,
      });
      expect(approved).toMatchObject({
        status: "completed",
        publicationStatus: "published",
      });
      expect(
        await owner.mutation(approve, { commandId: proposal.commandId }),
      ).toEqual(approved);
      await t.run(async (ctx) => {
        expect(await ctx.db.query("forumChatMessages").collect()).toHaveLength(
          1,
        );
        expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
      });
    },
  );

  test.each(["policy", "identity", "board rights"] as const)(
    "chat review rechecks %s before execution and never drains proposals on mode changes",
    async (change) => {
      const t = setup();
      const seed = await fixture(t, "agent", true);
      const owner = t.withIdentity({ subject: seed.owner });
      const proposal = await owner.mutation(
        execute,
        write(seed, "sendChatMessage", {
          body: "Recheck before committing this exact action.",
        }),
      );
      await t.run(async (ctx) => {
        if (change === "policy")
          await ctx.db.patch("forumPluginConnections", seed.connectionId, {
            policyVersion: 2,
            executionMode: "direct",
          });
        else if (change === "identity")
          await ctx.db.patch("forumPluginConnections", seed.connectionId, {
            actorMode: "human",
            actorUserId: seed.owner,
            policyVersion: 2,
          });
        else
          await ctx.db.patch("forumCategories", seed.board, {
            replyAccess: "staff",
          });
      });
      if (change === "board rights")
        expect(
          (await owner.mutation(approve, { commandId: proposal.commandId }))
            .data,
        ).toMatchObject({ state: "invalidated", reason: "target_changed" });
      else {
        const commands = await owner.query(listCommands, {});
        expect(
          commands.find(
            (command: { _id: string }) => command._id === proposal.commandId,
          ).status,
        ).toBe("invalidated");
        expect(
          (await owner.mutation(approve, { commandId: proposal.commandId }))
            .data.state,
        ).toBe("invalidated");
      }
      await t.run(async (ctx) => {
        expect(await ctx.db.query("forumChatMessages").collect()).toEqual([]);
        expect(await ctx.db.query("agentQuotaUsage").collect()).toEqual([]);
      });
    },
  );

  test.each(["replacement General board", "different visible parent"] as const)(
    "reviewed chat preserves its implicit room when changed to a %s",
    async (change) => {
      const t = setup();
      const seed = await fixture(t, "agent", true);
      const owner = t.withIdentity({ subject: seed.owner });
      const parents = await t.run(async (ctx) => {
        const now = Date.now();
        const ids = [];
        for (const slug of ["first-public-parent", "second-public-parent"]) {
          ids.push(
            await ctx.db.insert("forumCategories", {
              slug,
              name: slug,
              description: "Visible section",
              kind: "section",
              status: "active",
              viewAccess: "public",
              position: 0,
              threadCount: 0,
              postCount: 0,
              createdAt: now,
              updatedAt: now,
            }),
          );
        }
        if (change === "different visible parent")
          await ctx.db.patch("forumCategories", seed.board, {
            parentCategoryId: ids[0],
          });
        return ids;
      });
      const proposal = await owner.mutation(
        execute,
        write(seed, "sendChatMessage", {
          body: "This review request is bound to the original General room.",
        }),
      );
      expect(proposal.status).toBe("pending_approval");
      await t.run(async (ctx) => {
        if (change === "different visible parent")
          await ctx.db.patch("forumCategories", seed.board, {
            parentCategoryId: parents[1],
          });
        else {
          await ctx.db.patch("forumCategories", seed.board, {
            slug: "previous-general",
          });
          const now = Date.now();
          await ctx.db.insert("forumCategories", {
            slug: "general",
            name: "General",
            description: "Replacement room also permits posting",
            kind: "board",
            status: "active",
            viewAccess: "public",
            threadAccess: "members",
            replyAccess: "members",
            pollAccess: "trusted",
            position: 1,
            threadCount: 0,
            postCount: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
      });
      // Current authorization still permits a new action in this room. The old
      // exact proposal must nevertheless stop rather than silently retargeting.
      const current = await owner.query(
        makeFunctionReference<"query">("forum:listChatMessages"),
        pageArgs,
      );
      expect(current.viewer.canSend).toBe(true);
      const approved = await owner.mutation(approve, {
        commandId: proposal.commandId,
      });
      expect(approved.data).toMatchObject({
        state: "invalidated",
        reason: "target_changed",
      });
      await t.run(async (ctx) => {
        expect(await ctx.db.query("forumChatMessages").collect()).toEqual([]);
        expect(
          (await ctx.db.get("forumPluginCommands", proposal.commandId))?.status,
        ).toBe("invalidated");
        expect(await ctx.db.query("agentQuotaUsage").collect()).toEqual([]);
      });
    },
  );

  test("ordinary General board activity does not invalidate a reviewed chat action", async () => {
    const t = setup();
    const seed = await fixture(t, "human", true);
    const owner = t.withIdentity({ subject: seed.owner });
    const proposal = await owner.mutation(
      execute,
      write(seed, "sendChatMessage", {
        body: "Unrelated activity should not cancel this proposal.",
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", seed.board, {
        threadCount: 100,
        postCount: 200,
        lastPostAt: Date.now() + 1,
        updatedAt: Date.now() + 1,
      });
    });
    const approved = await owner.mutation(approve, {
      commandId: proposal.commandId,
    });
    expect(approved).toMatchObject({
      status: "completed",
      publicationStatus: "published",
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumChatMessages").collect()).toHaveLength(1);
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
  });
});
