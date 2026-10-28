// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { enqueueRelay } from "./xTelegramRelayData";
import {
  relayPost,
  relayMessage,
  SYMFORUM_X_USER_ID,
} from "../lib/x-telegram-relay";
import { TELEGRAM_COMMUNITY_ID } from "../lib/telegram-agent-policy";
const modules = import.meta.glob("./**/*.ts");
const topicId = 987;
const source = (id = "2113000000000000000") => ({
  id,
  authorId: SYMFORUM_X_USER_ID,
  text: "A public post <b>not HTML</b>",
  createdAt: Date.now(),
});
const raw = () => ({
  id: source().id,
  author_id: SYMFORUM_X_USER_ID,
  text: source().text,
  created_at: new Date().toISOString(),
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("TELEGRAM_AGENTS_ENABLED", "true");
  vi.stubEnv(
    "TELEGRAM_AGENT_BOTS",
    JSON.stringify({
      suki: {
        token: "123456789:abcdefghijklmnopqrstuvwxyzABCDE123456",
        id: "123456789",
        username: "symbaiex_suki_bot",
      },
    }),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function setup() {
  const t = convexTest(schema, modules);
  const cutoff = await t.mutation(internal.xTelegramRelayData.initialize, {
    topicId,
  });
  return { t, cutoff };
}
async function queue(
  t: Awaited<ReturnType<typeof setup>>["t"],
  post = source(),
) {
  await t.run((ctx) => enqueueRelay(ctx, [post]));
  return await t.run((ctx) =>
    ctx.db
      .query("xTelegramDeliveries")
      .withIndex("by_postId", (q) => q.eq("postId", post.id))
      .unique(),
  );
}
test("only @symforum authored posts and replies parse; reposts, sensitive and malformed sources do not", () => {
  expect(relayPost(raw())?.authorId).toBe(SYMFORUM_X_USER_ID);
  expect(
    relayPost({
      ...raw(),
      referenced_tweets: [{ type: "replied_to", id: "123" }],
    }),
  ).not.toBeNull();
  expect(
    relayPost({ ...raw(), referenced_tweets: [{ type: "quoted", id: "123" }] }),
  ).not.toBeNull();
  for (const overrides of [
    { author_id: "1494195618213990401" },
    { possibly_sensitive: true },
    { id: "bad" },
    { created_at: "bad" },
    { text: "" },
    { text: "a".repeat(25001) },
    { referenced_tweets: {} },
    { referenced_tweets: [{ type: "retweeted" }] },
  ])
    expect(relayPost({ ...raw(), ...overrides })).toBeNull();
});
test("plain text remains clean and long posts retain a bounded canonical source link", () => {
  const m = relayMessage("a".repeat(25000), source().id);
  expect(m.length).toBeLessThan(4096);
  expect(m.endsWith(`https://x.com/symforum/status/${source().id}`)).toBe(true);
  expect(relayMessage("<b>literal</b>", "123")).toContain("<b>literal</b>");
  expect(() => relayMessage("x", "not-a-post")).toThrow();
});
test("activation is internal only, topic-bound, and cannot reset its forward cutoff", async () => {
  const { t } = await setup();
  await expect(
    t.mutation(internal.xTelegramRelayData.initialize, { topicId: 988 }),
  ).rejects.toThrow("already configured");
  await expect(
    convexTest(schema, modules).mutation(
      internal.xTelegramRelayData.initialize,
      { topicId: -1 },
    ),
  ).rejects.toThrow("Invalid topic");
});
test("historical/future/impostor sources cannot enter; pages and posts are permanently deduplicated", async () => {
  const { t, cutoff } = await setup();
  for (const post of [
    { ...source(), createdAt: cutoff - 1 },
    { ...source(), createdAt: Date.now() + 120000 },
    { ...source(), authorId: "1494195618213990401" },
    { ...source(), id: "bad" },
  ])
    expect(await queue(t, post)).toBeNull();
  const d = await queue(t);
  expect(d?.status).toBe("queued");
  expect(d?.topicId).toBe(topicId);
  expect((await queue(t))?._id).toBe(d!._id);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("xTelegramDeliveries")
        .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "queued"))
        .take(6),
    ),
  ).toHaveLength(1);
});
test("disabled relay and oversized pages do not enqueue", async () => {
  const { t } = await setup();
  await t.run((ctx) =>
    enqueueRelay(
      ctx,
      Array.from({ length: 6 }, (_, i) => source(String(i + 1))),
    ),
  );
  expect(
    await t.run((ctx) => ctx.db.query("xTelegramDeliveries").take(1)),
  ).toEqual([]);
  await t.mutation(internal.xTelegramRelayData.disable, {});
  expect(await queue(t)).toBeNull();
});
test("confirmed Telegram delivery is bound to the correct community/topic and never sent twice", async () => {
  const { t } = await setup();
  const d = await queue(t);
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    expect(b.chat_id).toBe(TELEGRAM_COMMUNITY_ID);
    expect(b.message_thread_id).toBe(topicId);
    expect(b.parse_mode).toBeUndefined();
    expect(b.text).toContain(source().text);
    return Response.json({
      ok: true,
      result: {
        chat: { id: Number(TELEGRAM_COMMUNITY_ID) },
        message_thread_id: topicId,
        message_id: 1234,
      },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  await t.action(internal.xTelegramRelay.deliver, { id: d!._id });
  await t.action(internal.xTelegramRelay.deliver, { id: d!._id });
  const saved = await t.run((ctx) => ctx.db.get("xTelegramDeliveries", d!._id));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(saved?.status).toBe("sent");
  expect(saved?.messageId).toBe(1234);
  expect(saved?.text).toBeUndefined();
});
test.each([
  "network",
  "wrong_topic",
  "wrong_chat",
  "invalid",
  "500",
  "429",
  "403",
])("%s outcome is held without replay or content/secret logs", async (kind) => {
  const { t } = await setup();
  const d = await queue(t);
  const fetcher = vi.fn(async () => {
    if (kind === "network") throw Error("sensitive provider details");
    if (kind === "invalid") return new Response("not-json");
    if (["500", "429", "403"].includes(kind))
      return Response.json(
        { ok: false, error_code: Number(kind) },
        { status: Number(kind) },
      );
    return Response.json({
      ok: true,
      result: {
        chat: {
          id: kind === "wrong_chat" ? 123 : Number(TELEGRAM_COMMUNITY_ID),
        },
        message_thread_id: kind === "wrong_topic" ? 988 : topicId,
        message_id: 1234,
      },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  await t.action(internal.xTelegramRelay.deliver, { id: d!._id });
  await t.action(internal.xTelegramRelay.deliver, { id: d!._id });
  await queue(t);
  const saved = await t.run((ctx) => ctx.db.get("xTelegramDeliveries", d!._id));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(saved?.status).toBe("held");
  expect(saved?.text).toBeUndefined();
  expect(saved?.messageId).toBeUndefined();
  expect(JSON.stringify(saved)).not.toContain("sensitive");
});
test("an interrupted claim remains fenced permanently", async () => {
  const { t } = await setup();
  const d = await queue(t);
  expect(
    await t.mutation(internal.xTelegramRelayData.claim, { id: d!._id }),
  ).not.toBeNull();
  expect(
    await t.mutation(internal.xTelegramRelayData.claim, { id: d!._id }),
  ).toBeNull();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await t.action(internal.xTelegramRelay.deliver, { id: d!._id });
  expect(fetcher).not.toHaveBeenCalled();
});
test("disable or global Telegram stop before claim holds queued work without a network call", async () => {
  for (const stop of ["config", "global"]) {
    const { t } = await setup();
    const d = await queue(t);
    if (stop === "config")
      await t.mutation(internal.xTelegramRelayData.disable, {});
    else vi.stubEnv("TELEGRAM_AGENTS_ENABLED", "false");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await t.action(internal.xTelegramRelay.deliver, { id: d!._id });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (await t.run((ctx) => ctx.db.get("xTelegramDeliveries", d!._id)))?.status,
    ).toBe("held");
  }
});
