// @vitest-environment node
/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { telegramWebhookSecret } from "../lib/telegram-agent-policy";
const modules = import.meta.glob("./**/*.ts");
const sukiToken = `123456789:${"a".repeat(35)}`;
const nyxToken = `987654321:${"b".repeat(35)}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T17:00:00Z"));
  vi.stubEnv("TELEGRAM_AGENTS_ENABLED", "true");
  vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
  vi.stubEnv("TELEGRAM_DIGEST_ENABLED", "true");
  vi.stubEnv("TELEGRAM_DIGEST_TOPIC_ID", "273");
  vi.stubEnv(
    "TELEGRAM_AGENT_BOTS",
    JSON.stringify({
      suki: { token: sukiToken, username: "symbaiex_suki_bot" },
      nyx: { token: nyxToken, username: "symbaiex_nyx_bot" },
    }),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  workflowTest.register(t);
  registerLimiter(t);
  await t.run(async (ctx) => {
    for (const slug of ["suki", "nyx"]) {
      const userId = await ctx.db.insert("users", {
        name: slug,
        isAgent: true,
        agentSlug: slug,
      });
      await ctx.db.insert("forumAgents", {
        slug,
        name: slug === "nyx" ? "NyX" : "Suki",
        userId,
        persona: "Public Forum participant",
        model: "openai/gpt-6-luna",
        enabled: true,
        dailyPostTarget: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  });
  return t;
}

const request = {
  agentSlug: "suki",
  botId: "123456789",
  updateId: 10,
  messageId: 3,
  topicId: 85,
  senderId: "101",
  text: "",
  kind: "menu" as const,
};

test("menu renders current connected identities without inference and sends once", async () => {
  const t = await setup();
  const sent: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe(`https://api.telegram.org/bot${sukiToken}/sendMessage`);
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, result: { message_id: 50 } });
  });
  vi.stubGlobal("fetch", fetcher);
  await t.mutation(internal.telegramAgents.accept, request);
  const [row] = await t.run((ctx) =>
    ctx.db.query("telegramAgentRequests").take(1),
  );
  await t.action(internal.telegramAgentReply.respond, { requestId: row._id });
  await t.action(internal.telegramAgentReply.respond, { requestId: row._id });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(sent[0]).toMatchObject({
    chat_id: "-1004387387301",
    message_thread_id: 85,
    reply_markup: {
      inline_keyboard: [
        [{ callback_data: "agent:suki" }, { callback_data: "agent:nyx" }],
      ],
    },
  });
  expect(
    await t.run((ctx) => ctx.db.get("telegramAgentRequests", row._id)),
  ).toMatchObject({ status: "sent" });
});

test("authenticated callbacks deduplicate by source bot and prompt from the selected identity in the same topic", async () => {
  const t = await setup();
  const headers = {
    "content-type": "application/json",
    "x-telegram-bot-api-secret-token": await telegramWebhookSecret(sukiToken),
  };
  const input = {
    update_id: 10,
    callback_query: {
      id: "selection-1",
      data: "agent:nyx",
      from: { id: 101, is_bot: false },
      message: {
        message_id: 50,
        message_thread_id: 85,
        date: 1,
        from: { id: 123456789, is_bot: true },
        chat: { id: -1004387387301, type: "supergroup" },
      },
    },
  };
  for (let i = 0; i < 2; i++) {
    const response = await t.fetch("/telegram/agents/suki", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(await response.json()).toMatchObject({
      method: "answerCallbackQuery",
      callback_query_id: "selection-1",
    });
  }
  const rows = await t.run((ctx) =>
    ctx.db.query("telegramAgentRequests").take(10),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    agentSlug: "nyx",
    botId: "987654321",
    sourceAgentSlug: "suki",
    key: "123456789:10",
    kind: "prompt",
  });
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      expect(url.startsWith(`https://api.telegram.org/bot${nyxToken}/`)).toBe(
        true,
      );
      if (url.endsWith("getWebhookInfo"))
        return Response.json({
          ok: true,
          result: {
            url: "https://strong-bee-384.convex.site/telegram/agents/nyx",
          },
        });
      if (url.endsWith("getChatMember"))
        return Response.json({ ok: true, result: { status: "member" } });
      expect(url.endsWith("sendMessage")).toBe(true);
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, result: { message_id: 51 } });
    }),
  );
  await t.action(internal.telegramAgentReply.respond, {
    requestId: rows[0]._id,
  });
  expect(sent[0]).toMatchObject({
    message_thread_id: 85,
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true },
  });
  expect(String(sent[0].text)).toContain('href="tg://user?id=101"');
  expect(String(sent[0].text)).toContain("NyX");
  expect(sent[0]).not.toHaveProperty("reply_parameters");
  expect(
    await t.run((ctx) => ctx.db.get("telegramAgentRequests", rows[0]._id)),
  ).toMatchObject({ status: "sent" });
  // The target bot's independently numbered updates must not collide with the source callback.
  expect(
    await t.mutation(internal.telegramAgents.accept, {
      ...request,
      agentSlug: "nyx",
      botId: "987654321",
      kind: "help",
    }),
  ).toBe(true);
});

test("former members and disabled choices receive no prompt or model request", async () => {
  const t = await setup();
  const choice = {
    ...request,
    kind: "prompt" as const,
    agentSlug: "nyx",
    botId: "987654321",
    sourceAgentSlug: "suki",
  };
  await t.mutation(internal.telegramAgents.accept, choice);
  const [row] = await t.run((ctx) =>
    ctx.db.query("telegramAgentRequests").take(1),
  );
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith("getWebhookInfo")
      ? Response.json({
          ok: true,
          result: {
            url: "https://strong-bee-384.convex.site/telegram/agents/nyx",
          },
        })
      : Response.json({ ok: true, result: { status: "left" } }),
  );
  vi.stubGlobal("fetch", fetcher);
  await t.action(internal.telegramAgentReply.respond, { requestId: row._id });
  await t.action(internal.telegramAgentReply.respond, { requestId: row._id });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    await t.run((ctx) => ctx.db.get("telegramAgentRequests", row._id)),
  ).toMatchObject({ status: "held" });
  await t.run(async (ctx) => {
    const nyx = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", "nyx"))
      .unique();
    await ctx.db.patch("forumAgents", nyx!._id, { enabled: false });
  });
  expect(
    await t.mutation(internal.telegramAgents.accept, {
      ...choice,
      updateId: 11,
    }),
  ).toBe(false);
});

async function source(
  t: Awaited<ReturnType<typeof setup>>,
  privateParent = false,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const authorId = await ctx.db.insert("users", { name: "Human & builder" });
    const parent = await ctx.db.insert("forumCategories", {
      slug: "root",
      name: "Root",
      description: "",
      status: "active",
      viewAccess: privateParent ? "staff" : "public",
      position: 0,
      threadCount: 1,
      postCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const categoryId = await ctx.db.insert("forumCategories", {
      slug: "builders",
      name: "Builders",
      description: "",
      parentCategoryId: parent,
      status: "active",
      viewAccess: "public",
      position: 1,
      threadCount: 1,
      postCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const fields = {
      categoryId,
      categorySlug: "builders",
      slug: "example",
      title: "A useful <demo>",
      authorId,
      status: "active" as const,
      replyCount: 0,
      lastPostAt: now - 1000,
      createdAt: now - 2000,
      updatedAt: now - 1000,
    };
    const threadId = await ctx.db.insert("forumThreads", {
      ...fields,
      body: privateParent ? "PRIVATE NEEDLE" : "Public content",
      pinned: false,
      viewCount: 1,
      lastPostUserId: authorId,
      searchText: "example",
    });
    await ctx.db.insert("forumThreadEditorialDigests", {
      ...fields,
      threadId,
      viewCount: 1,
    });
    return { threadId, categoryId, parent };
  });
}

test("digest preview and delivery recheck private ancestors and current moderation state", async () => {
  const t = await setup();
  await source(t, true);
  const publicSource = await source(t);
  const preview = await t.query(internal.telegramForumDigest.preview, {
    now: Date.now(),
  });
  expect(preview.count).toBe(1);
  expect(preview.text).toContain("A useful &lt;demo&gt;");
  expect(preview.text).toContain("Human &amp; builder · Human member");
  expect(preview.text).not.toContain("PRIVATE NEEDLE");
  const digestId = await t.mutation(internal.telegramForumDigest.queuePreview, {
    key: "source-test",
  });
  await t.run((ctx) =>
    ctx.db.patch("forumCategories", publicSource.parent, {
      viewAccess: "staff",
    }),
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await t.action(internal.telegramForumDigest.deliver, { digestId: digestId! });
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await t.run((ctx) => ctx.db.get("telegramForumDigests", digestId!)),
  ).toMatchObject({ status: "skipped" });
});

test.each([false, true])(
  "weekly delivery is once-only and uncertain outcome is held (timeout=%s)",
  async (timeout) => {
    const t = await setup();
    await source(t);
    const digestId = await t.mutation(
      internal.telegramForumDigest.queueWeekly,
      {},
    );
    expect(digestId).not.toBeNull();
    expect(
      await t.mutation(internal.telegramForumDigest.queueWeekly, {}),
    ).toBeNull();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        chat_id: "-1004387387301",
        message_thread_id: 273,
        parse_mode: "HTML",
      });
      if (timeout) throw new Error("synthetic timeout");
      return Response.json({
        ok: true,
        result: {
          message_id: 100,
          message_thread_id: 273,
          chat: { id: -1004387387301 },
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await t.action(internal.telegramForumDigest.deliver, {
      digestId: digestId!,
    });
    await t.action(internal.telegramForumDigest.deliver, {
      digestId: digestId!,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      await t.mutation(internal.telegramForumDigest.queueWeekly, {}),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get("telegramForumDigests", digestId!)),
    ).toMatchObject({ status: timeout ? "held" : "sent" });
  },
);

test("digest kill switch and wrong destination prevent claiming delivery", async () => {
  const t = await setup();
  await source(t);
  const digestId = await t.mutation(
    internal.telegramForumDigest.queueWeekly,
    {},
  );
  vi.stubEnv("TELEGRAM_DIGEST_TOPIC_ID", "85");
  expect(
    await t.mutation(internal.telegramForumDigest.claim, {
      digestId: digestId!,
    }),
  ).toBeNull();
  expect(
    await t.mutation(internal.telegramForumDigest.queuePreview, { key: "off" }),
  ).toBeNull();
  expect(
    await t.run((ctx) => ctx.db.get("telegramForumDigests", digestId!)),
  ).toMatchObject({ status: "held" });
});

test("an unresolved report removes a public source from the digest without changing that source", async () => {
  const t = await setup();
  const item = await source(t);
  await t.run(async (ctx) => {
    const thread = await ctx.db.get("forumThreads", item.threadId);
    await ctx.db.insert("forumReports", {
      reporterId: thread!.authorId,
      entityType: "thread",
      threadId: item.threadId,
      reason: "abuse",
      status: "open",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  expect(
    (await t.query(internal.telegramForumDigest.preview, { now: Date.now() }))
      .count,
  ).toBe(0);
  expect(
    (await t.run((ctx) => ctx.db.get("forumThreads", item.threadId)))?.status,
  ).toBe("active");
});
