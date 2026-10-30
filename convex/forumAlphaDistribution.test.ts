// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RateLimiter, DAY } from "@convex-dev/rate-limiter";
import { components, api, internal } from "./_generated/api";
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
    const fetchMock = vi.fn().mockResolvedValue(
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

test("launch preview admits only a recent approved alpha run and never duplicates it", async () => {
  const s = await setup();
  const at = Date.now() - 60_000;
  const runId = await s.t.run((ctx) =>
    ctx.db.insert("forumAgentRuns", {
      runKey: "test:launch",
      agentSlug: "nyx",
      runDate: "2026-10-29",
      slot: 0,
      attempt: 0,
      status: "skipped",
      model: "synthetic",
      sourceUrls: ["https://project.org/news"],
      threadId: s.sourceThreadId,
      promptVersion: "roster:alpha-v1:brief-v2:nyx",
      qualityScore: 90,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  expect(
    await s.t.mutation(internal.forumAlphaDistribution.queueRecentApproved, {
      runKey: "test:launch",
      sourcePublishedAt: at,
    }),
  ).toBe(false);
  await s.t.run((ctx) =>
    ctx.db.patch("forumAgentRuns", runId, { status: "published" }),
  );
  expect(
    await s.t.mutation(internal.forumAlphaDistribution.queueRecentApproved, {
      runKey: "test:launch",
      sourcePublishedAt: at,
    }),
  ).toBe(true);
  expect(
    await s.t.mutation(internal.forumAlphaDistribution.queueRecentApproved, {
      runKey: "test:launch",
      sourcePublishedAt: at,
    }),
  ).toBe(false);
});

test("owner verification stores the full project identity for indirect coverage", async () => {
  const s = await setup();
  await s.owner.mutation(api.forumAlphaDistribution.verifyProject, {
    name: "Ondo Finance",
    host: "ondo.finance",
    username: "Ondo",
    proofUrl: "https://ondo.finance/",
  });
  const p = await s.t.run((ctx) => ctx.db.query("forumAlphaProjects").first());
  expect(p?.name).toBe("Ondo Finance");
  expect(p?.username).toBe("ondo");
  await expect(
    s.reader.mutation(api.forumAlphaDistribution.verifyProject, {
      name: "Other Project",
      host: "project.org",
      username: "project",
      proofUrl: "https://project.org/",
    }),
  ).rejects.toThrow();
});

async function breakingQueued() {
  vi.stubEnv("FORUM_BREAKING_NEWS_ENABLED", "true");
  vi.stubEnv("FORUM_ALPHA_EDITORIAL_ENABLED", "true");
  vi.stubEnv("FORUM_ALPHA_LEAD_MINUTES", "15");
  const s = await setup();
  await s.t.run(async (ctx) => {
    await ctx.db.patch("forumThreads", s.sourceThreadId, {
      title: "Solana launches a new mainnet integration",
      body: "Solana announced a new integration. The deployment is available on mainnet.",
    });
    await queueAlphaPublication(ctx, {
      threadId: s.sourceThreadId,
      promptVersion: "roster:alpha-v1:brief-v2:breaking-v1",
      qualityScore: 95,
      sourcePublishedAt: Date.now() - 60_000,
      sourceUrls: ["https://solana.com/news/integration"],
    });
  });
  const row = await s.t.run((ctx) =>
    ctx.db.query("forumAlphaDeliveries").first(),
  );
  expect(row?.newsPriority).toBe("urgent");
  await s.t.mutation(internal.forumAlphaDistribution.claimTelegram, {
    id: row!._id,
  });
  await s.t.mutation(internal.forumAlphaDistribution.finishTelegram, {
    id: row!._id,
    messageId: 123,
  });
  const { accountId, activityId } = await s.t.run(async (ctx) => {
    const accountId = await ctx.db.insert("xAgentAccounts", {
      agentSlug: "nyx",
      ownerUserId: s.ownerId,
      expectedUsername: "symbaiex_nyx",
      epoch: 1,
      connected: true,
      mode: "automatic",
      xUserId: "1234",
      username: "symbaiex_nyx",
      grant: { ciphertext: "sealed", nonce: "nonce" },
      scope: "tweet.read users.read offline.access tweet.write",
      expiresAt: Date.now() + 3600_000,
      updatedAt: Date.now(),
    });
    const activityId = await ctx.db.insert("xAgentActivity", {
      accountId,
      epoch: 1,
      enabled: true,
      enabledAt: Date.now(),
      nextPollAt: Date.now(),
      options: {
        originals: true,
        reposts: true,
        comments: true,
        aiRepliesApproved: true,
      },
      cursors: [],
    });
    return { accountId, activityId };
  });
  return { ...s, id: row!._id, accountId, activityId };
}
test("breaking news uses NyX immediately after confirmed Telegram, once, through the existing worker", async () => {
  const s = await breakingQueued();
  expect(
    (await s.t.run((ctx) => ctx.db.get("forumAlphaDeliveries", s.id)))!
      .notBefore,
  ).toBeLessThanOrEqual(Date.now());
  // It must never fall through to the @symforum publisher.
  expect(
    await s.t.mutation(internal.forumAlphaDistribution.claimX, { id: s.id }),
  ).toBeNull();
  await s.t.mutation(internal.forumBreakingX.queue, { id: s.id });
  await s.t.mutation(internal.forumBreakingX.queue, { id: s.id });
  const ops = await s.t.run((ctx) => ctx.db.query("xAgentOperations").take(5));
  expect(ops).toHaveLength(1);
  expect(ops[0].accountId).toBe(s.accountId);
  expect(ops[0].alphaDeliveryId).toBe(s.id);
  const args = { activityId: s.activityId, lease: "breaking-test" };
  await s.t.mutation(internal.xAgentActivityData.claim, args);
  expect(
    await s.t.mutation(internal.xAgentActivityData.claimSend, {
      ...args,
      operationId: ops[0]._id,
    }),
  ).toEqual({ text: expect.stringContaining("Solana launches") });
  await s.t.mutation(internal.xAgentActivityData.finishSend, {
    ...args,
    operationId: ops[0]._id,
    confirmed: true,
    resultId: "2116000000000000001",
  });
  const row = await s.t.run((ctx) => ctx.db.get("forumAlphaDeliveries", s.id));
  expect(row?.xStatus).toBe("sent");
  expect(row?.xPostId).toBe("2116000000000000001");
  expect(row?.xSentAt).toBeTypeOf("number");
});
test("paused NyX never posts, and edited source stops an already queued breaking operation", async () => {
  const s = await breakingQueued();
  await s.t.run((ctx) =>
    ctx.db.patch("xAgentAccounts", s.accountId, { mode: "drafts" }),
  );
  await s.t.mutation(internal.forumBreakingX.queue, { id: s.id });
  expect(
    await s.t.run((ctx) => ctx.db.query("xAgentOperations").take(5)),
  ).toHaveLength(0);
  await s.t.run((ctx) =>
    ctx.db.patch("xAgentAccounts", s.accountId, { mode: "automatic" }),
  );
  await s.t.mutation(internal.forumBreakingX.queue, { id: s.id });
  const op = await s.t.run((ctx) => ctx.db.query("xAgentOperations").first());
  await s.t.run((ctx) =>
    ctx.db.patch("forumThreads", s.sourceThreadId, {
      body: "Edited after review",
    }),
  );
  const args = { activityId: s.activityId, lease: "source-edit" };
  await s.t.mutation(internal.xAgentActivityData.claim, args);
  expect(
    await s.t.mutation(internal.xAgentActivityData.claimSend, {
      ...args,
      operationId: op!._id,
    }),
  ).toBeNull();
  await s.t.mutation(internal.forumBreakingX.queue, { id: s.id });
  expect(
    await s.t.run((ctx) => ctx.db.query("xAgentOperations").take(5)),
  ).toHaveLength(1);
  expect(
    (await s.t.run((ctx) => ctx.db.get("xAgentOperations", op!._id)))!.status,
  ).toBe("held");
});
test("routine news stays on Forum and Telegram without rearming X after Telegram delivery", async () => {
  vi.stubEnv("FORUM_BREAKING_NEWS_ENABLED", "true");
  const s = await setup();
  await s.t.run(async (ctx) => {
    await ctx.db.patch("forumThreads", s.sourceThreadId, {
      title: "Solana integration adds another deployment",
      body: "The Solana deployment was announced four hours ago.",
    });
    await queueAlphaPublication(ctx, {
      threadId: s.sourceThreadId,
      promptVersion: "roster:alpha-v1:breaking-v1",
      qualityScore: 95,
      sourcePublishedAt: Date.now() - 4 * 3600_000,
      sourceUrls: ["https://solana.com/news/old"],
    });
  });
  const row = await s.t.run((ctx) =>
    ctx.db.query("forumAlphaDeliveries").first(),
  );
  expect(row?.newsPriority).toBe("routine");
  expect(row?.xStatus).toBe("skipped");
  await s.t.mutation(internal.forumAlphaDistribution.claimTelegram, {
    id: row!._id,
  });
  await s.t.mutation(internal.forumAlphaDistribution.finishTelegram, {
    id: row!._id,
    messageId: 234,
  });
  expect(
    (await s.t.run((ctx) => ctx.db.get("forumAlphaDeliveries", row!._id)))
      ?.xStatus,
  ).toBe("skipped");
});

test("NyX breaking news shares the existing six-original daily quota and never retries an uncertain send", async () => {
  const s = await breakingQueued();
  await s.t.mutation(internal.forumBreakingX.queue, { id: s.id });
  const op = await s.t.run((ctx) => ctx.db.query("xAgentOperations").first());
  const shared = new RateLimiter(components.rateLimiter, {
    xOriginals: { kind: "fixed window", rate: 6, period: DAY },
  });
  await s.t.run(async (ctx) => {
    for (let i = 0; i < 6; i++)
      await shared.limit(ctx, "xOriginals", { key: s.accountId });
  });
  const args = { activityId: s.activityId, lease: "daily-limit" };
  await s.t.mutation(internal.xAgentActivityData.claim, args);
  expect(
    await s.t.mutation(internal.xAgentActivityData.claimSend, {
      ...args,
      operationId: op!._id,
    }),
  ).toBeNull();
  expect(
    (await s.t.run((ctx) => ctx.db.get("xAgentOperations", op!._id)))?.status,
  ).toBe("queued");
  await s.t.run((ctx) =>
    ctx.db.patch("xAgentOperations", op!._id, {
      status: "held",
      issue: "uncertain",
    }),
  );
  await s.t.mutation(internal.forumBreakingX.queue, { id: s.id });
  expect(
    await s.t.run((ctx) => ctx.db.query("xAgentOperations").take(10)),
  ).toHaveLength(1);
});
