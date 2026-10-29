// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sealX } from "../lib/x-agent-crypto";
import { queueAlphaPublication } from "./forumAlphaDistribution";
import agentTest from "@convex-dev/agent/test";
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.stubEnv("FORUM_ALPHA_DISTRIBUTION_ENABLED", "true");
  vi.stubEnv("TELEGRAM_AGENTS_ENABLED", "true");
  vi.stubEnv("TELEGRAM_ALPHA_TOPIC_ID", "999");
  vi.stubEnv("X_AGENTS_ENABLED", "true");
  vi.stubEnv(
    "TELEGRAM_AGENT_BOTS",
    JSON.stringify({
      suki: {
        username: "symbaiex_suki_bot",
        token: "123456:synthetic-only-token-abcdefghijklmnopqrstuvwxyz",
      },
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
async function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      role: "owner",
      name: "Owner",
    });
    const readerId = await ctx.db.insert("users", { role: "reader" });
    const userId = await ctx.db.insert("users", {
      isAgent: true,
      agentSlug: "nyx",
    });
    await ctx.db.insert("forumAgents", {
      slug: "nyx",
      name: "NyX",
      persona: "Dry skeptic",
      userId,
      model: "synthetic",
      enabled: true,
      dailyPostTarget: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const categoryId = await ctx.db.insert("forumCategories", {
      slug: "crypto",
      name: "Research",
      description: "",
      status: "active",
      viewAccess: "public",
      position: 0,
      threadCount: 1,
      postCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const sourceThreadId = await ctx.db.insert("forumThreads", {
      categoryId,
      categorySlug: "crypto",
      slug: "agent-memory",
      title: "Agent memory and source visibility",
      body: "A retrieval cache retained text after source visibility changed. Recheck access before retrieval.",
      authorId: userId,
      lastPostUserId: userId,
      status: "active",
      pinned: false,
      replyCount: 0,
      viewCount: 1,
      searchText: "agent memory",
      lastPostAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ownerId, readerId, categoryId, sourceThreadId };
  });
  return {
    t,
    ...ids,
    owner: t.withIdentity({ subject: ids.ownerId }),
    reader: t.withIdentity({ subject: ids.readerId }),
  };
}

async function queued() {
  const s = await setup();
  await s.t.run((ctx) =>
    queueAlphaPublication(ctx, {
      threadId: s.sourceThreadId,
      promptVersion: "roster:alpha-v1:nyx",
      qualityScore: 90,
      sourcePublishedAt: Date.now() - 60_000,
      sourceUrls: ["https://project.org/news"],
    }),
  );
  const row = await s.t.run((ctx) =>
    ctx.db.query("forumAlphaDeliveries").first(),
  );
  expect(row).not.toBeNull();
  return { ...s, id: row!._id };
}
async function connect(s: Awaited<ReturnType<typeof setup>>) {
  return await s.t.run((ctx) =>
    ctx.db.insert("xAgentAccounts", {
      agentSlug: "symforum",
      ownerUserId: s.ownerId,
      expectedUsername: "symforum",
      epoch: 1,
      connected: true,
      mode: "drafts",
      xUserId: "2112678767726366720",
      username: "symforum",
      grant: { ciphertext: "sealed", nonce: "nonce" },
      scope: "tweet.read users.read offline.access tweet.write",
      expiresAt: Date.now() + 3600_000,
      updatedAt: Date.now(),
    }),
  );
}
describe("Telegram first project distribution", () => {
  test("does not admit history, lower quality or stale news", async () => {
    const s = await setup();
    for (const overrides of [
      { promptVersion: "legacy" },
      { qualityScore: 84 },
      { sourcePublishedAt: Date.now() - 25 * 3600_000 },
    ])
      await s.t.run((ctx) =>
        queueAlphaPublication(ctx, {
          threadId: s.sourceThreadId,
          promptVersion: "x:alpha-v1:nyx",
          qualityScore: 90,
          sourcePublishedAt: Date.now(),
          sourceUrls: [],
          ...overrides,
        }),
      );
    expect(
      await s.t.run((ctx) => ctx.db.query("forumAlphaDeliveries").first()),
    ).toBeNull();
  });
  test("enqueues once and claims only one Telegram sender", async () => {
    const s = await queued();
    await s.t.run((ctx) =>
      queueAlphaPublication(ctx, {
        threadId: s.sourceThreadId,
        promptVersion: "x:alpha-v1:nyx",
        qualityScore: 90,
        sourcePublishedAt: Date.now(),
        sourceUrls: [],
      }),
    );
    expect(
      await s.t.run((ctx) => ctx.db.query("forumAlphaDeliveries").collect()),
    ).toHaveLength(1);
    expect(
      await s.t.mutation(internal.forumAlphaDistribution.claimTelegram, {
        id: s.id,
      }),
    ).not.toBeNull();
    expect(
      await s.t.mutation(internal.forumAlphaDistribution.claimTelegram, {
        id: s.id,
      }),
    ).toBeNull();
  });
  test("unknown Telegram send fences X permanently", async () => {
    const s = await queued();
    await connect(s);
    await s.t.mutation(internal.forumAlphaDistribution.claimTelegram, {
      id: s.id,
    });
    await s.t.mutation(internal.forumAlphaDistribution.finishTelegram, {
      id: s.id,
    });
    expect(
      await s.t.mutation(internal.forumAlphaDistribution.claimX, { id: s.id }),
    ).toBeNull();
    expect(
      (await s.t.run((ctx) => ctx.db.get("forumAlphaDeliveries", s.id)))
        ?.xStatus,
    ).toBe("held");
  });
  test("lead starts at confirmed delivery, never Forum creation", async () => {
    const s = await queued();
    await connect(s);
    await s.t.mutation(internal.forumAlphaDistribution.claimTelegram, {
      id: s.id,
    });
    await s.t.mutation(internal.forumAlphaDistribution.finishTelegram, {
      id: s.id,
      messageId: 123,
    });
    expect(
      await s.t.mutation(internal.forumAlphaDistribution.claimX, { id: s.id }),
    ).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(
      await s.t.mutation(internal.forumAlphaDistribution.claimX, { id: s.id }),
    ).not.toBeNull();
    expect(
      await s.t.mutation(internal.forumAlphaDistribution.claimX, { id: s.id }),
    ).toBeNull();
    expect(
      await s.t.mutation(internal.forumAlphaDistribution.authorizeXSend, {
        id: s.id,
      }),
    ).toContain("forum.symbaiex.com");
  });
  test("hidden or edited source is not sent", async () => {
    const s = await queued();
    await s.t.run((ctx) =>
      ctx.db.patch("forumCategories", s.categoryId, { viewAccess: "members" }),
    );
    expect(
      await s.t.mutation(internal.forumAlphaDistribution.claimTelegram, {
        id: s.id,
      }),
    ).toBeNull();
    expect(
      (await s.t.run((ctx) => ctx.db.get("forumAlphaDeliveries", s.id)))
        ?.telegramStatus,
    ).toBe("skipped");
  });
  test("revocation between refresh and send cancels X", async () => {
    const s = await queued();
    const account = await connect(s);
    await s.t.mutation(internal.forumAlphaDistribution.claimTelegram, {
      id: s.id,
    });
    await s.t.mutation(internal.forumAlphaDistribution.finishTelegram, {
      id: s.id,
      messageId: 123,
    });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await s.t.mutation(internal.forumAlphaDistribution.claimX, { id: s.id });
    await s.t.run((ctx) =>
      ctx.db.patch("xAgentAccounts", account, { epoch: 2, connected: false }),
    );
    expect(
      await s.t.mutation(internal.forumAlphaDistribution.authorizeXSend, {
        id: s.id,
      }),
    ).toBeNull();
  });
  test("owner console hides grants and rejects readers", async () => {
    const s = await queued();
    await connect(s);
    expect(
      JSON.stringify(
        await s.owner.query(api.forumAlphaDistribution.dashboard, {}),
      ),
    ).not.toContain("sealed");
    await expect(
      s.reader.query(api.forumAlphaDistribution.dashboard, {}),
    ).rejects.toThrow();
  });
});

describe("isolated project account", () => {
  test("requires the exact brand handle and verified numeric ID", async () => {
    const s = await setup();
    const stateHash = "b".repeat(64);
    await expect(
      s.owner.mutation(internal.xAgentAccounts.prepareAuthorization, {
        agentSlug: "symforum",
        expectedUsername: "other",
        stateHash,
        verifier: { ciphertext: "c", nonce: "n" },
      }),
    ).rejects.toThrow();
    await s.owner.mutation(internal.xAgentAccounts.prepareAuthorization, {
      agentSlug: "symforum",
      expectedUsername: "symforum",
      stateHash,
      verifier: { ciphertext: "c", nonce: "n" },
    });
    const c = await s.owner.mutation(
      internal.xAgentAccounts.claimAuthorization,
      { stateHash },
    );
    await expect(
      s.owner.mutation(internal.xAgentAccounts.completeAuthorization, {
        authorizationId: c.id,
        xUserId: "999",
        username: "symforum",
        grant: { ciphertext: "c", nonce: "n" },
        scope: "tweet.read users.read offline.access tweet.write",
        expiresAt: Date.now() + 3600_000,
      }),
    ).rejects.toThrow("Wrong X account");
  });
  test("cannot become a mascot loop or ordinary agent draft writer", async () => {
    const s = await setup();
    await connect(s);
    await expect(
      s.owner.mutation(api.xAgentActivityData.configure, {
        agentSlug: "symforum",
        options: { reposts: true, comments: false, aiRepliesApproved: false },
      }),
    ).rejects.toThrow();
    vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
    await expect(
      s.owner.mutation(api.xAgentAccounts.requestDraft, {
        agentSlug: "symforum",
        brief: "hi",
        requestKey: "11111111-1111-1111-1111-111111111111",
      }),
    ).rejects.toThrow();
  });
});

describe("external delivery receipts", () => {
  afterEach(() => vi.unstubAllGlobals());
  test("records a matching Telegram receipt and never sends it twice", async () => {
    const s = await queued();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 900,
            chat: { id: -1004387387301 },
            message_thread_id: 999,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await s.t.action(internal.forumAlphaDelivery.deliver, {
      id: s.id,
      destination: "telegram",
    });
    const r = await s.t.run((ctx) => ctx.db.get("forumAlphaDeliveries", s.id));
    expect(r?.telegramStatus).toBe("sent");
    expect(r?.telegramMessageId).toBe(900);
    await s.t.action(internal.forumAlphaDelivery.deliver, {
      id: s.id,
      destination: "telegram",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.disable_notification).toBe(true);
    expect(sent.message_thread_id).toBe(999);
    expect(sent.text).not.toContain("@random");
  });
  test("a receipt from a different topic is held and blocks X", async () => {
    const s = await queued();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 900,
              chat: { id: -1004387387301 },
              message_thread_id: 9,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    await s.t.action(internal.forumAlphaDelivery.deliver, {
      id: s.id,
      destination: "telegram",
    });
    const r = await s.t.run((ctx) => ctx.db.get("forumAlphaDeliveries", s.id));
    expect(r?.telegramStatus).toBe("held");
    expect(r?.xStatus).toBe("held");
  });
  test("a crashed claimed X operation never re-enters the queue", async () => {
    const s = await queued();
    await connect(s);
    await s.t.mutation(internal.forumAlphaDistribution.claimTelegram, {
      id: s.id,
    });
    await s.t.mutation(internal.forumAlphaDistribution.finishTelegram, {
      id: s.id,
      messageId: 123,
    });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await s.t.mutation(internal.forumAlphaDistribution.claimX, { id: s.id });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await s.t.mutation(internal.forumAlphaDistribution.expire, {});
    expect(
      (await s.t.run((ctx) => ctx.db.get("forumAlphaDeliveries", s.id)))
        ?.xStatus,
    ).toBe("held");
    expect(
      await s.t.mutation(internal.forumAlphaDistribution.claimX, { id: s.id }),
    ).toBeNull();
  });
});

describe("X account breathing room", () => {
  afterEach(() => vi.unstubAllGlobals());
  test("defers around a recent manual original without sending", async () => {
    const s = await queued();
    const a = await connect(s);
    vi.stubEnv("X_AGENT_TOKEN_KEK", "a".repeat(64));
    const grant = await sealX(
      "a".repeat(64),
      JSON.stringify({ accessToken: "synthetic", refreshToken: "synthetic" }),
      `${s.ownerId}:symforum:grant:v1`,
    );
    await s.t.run((ctx) => ctx.db.patch("xAgentAccounts", a, { grant }));
    await s.t.mutation(internal.forumAlphaDistribution.claimTelegram, {
      id: s.id,
    });
    await s.t.mutation(internal.forumAlphaDistribution.finishTelegram, {
      id: s.id,
      messageId: 123,
    });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { created_at: new Date(Date.now() - 10 * 60_000).toISOString() },
            ],
            meta: { result_count: 1 },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await s.t.action(internal.forumAlphaDelivery.deliver, {
      id: s.id,
      destination: "x",
    });
    const r = await s.t.run((ctx) => ctx.db.get("forumAlphaDeliveries", s.id));
    expect(r?.xStatus).toBe("queued");
    expect(r?.notBefore).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
