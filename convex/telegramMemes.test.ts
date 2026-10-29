// @vitest-environment node
/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { register } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  MEME_INTERVAL_MS,
  parseMeme,
  memeFingerprint,
} from "../lib/telegram-memes";
const modules = import.meta.glob("./**/*.ts");
let finishScheduled: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-28T07:00:00Z"));
  for (const [k, v] of Object.entries({
    TELEGRAM_MEMES_ENABLED: "true",
    TELEGRAM_MEMES_TOPIC_ID: "13",
    TELEGRAM_AGENTS_ENABLED: "true",
    ELIZA_RUNTIME_MODE: "live",
    TELEGRAM_AGENT_BOTS: JSON.stringify({
      belle: {
        token: `123456789:${"a".repeat(35)}`,
        username: "symbaiex_belle_bot",
      },
    }),
  }))
    vi.stubEnv(k, v);
});
afterEach(async () => {
  // Advancing fake time can start workflow functions that outlive the test.
  // Drain those before Vitest closes its worker; do not fire future timers.
  try {
    await finishScheduled?.();
  } finally {
    finishScheduled = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  }
});
async function setup() {
  const t = convexTest(schema, modules);
  finishScheduled = () => t.finishInProgressScheduledFunctions();
  agentTest.register(t);
  workflowTest.register(t);
  register(t);
  await t.run(async (ctx) => {
    const u = await ctx.db.insert("users", {
      name: "Belle",
      isAgent: true,
      agentSlug: "belle",
    });
    await ctx.db.insert("forumAgents", {
      slug: "belle",
      name: "Belle",
      userId: u,
      persona: "warm culture correspondent",
      model: "openai/gpt-6-luna",
      enabled: true,
      dailyPostTarget: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const storageId = await ctx.storage.store(
      new Blob(["synthetic-test-image"]),
    );
    await ctx.db.insert("telegramMemeConfig", { key: "belle", storageId });
  });
  return t;
}
test("strict captions reject URLs, multiline surprises, excessive text and markup mentions", () => {
  expect(parseMeme("TOP: quick fix\nBOTTOM: six new dependencies")).toEqual({
    top: "quick fix",
    bottom: "six new dependencies",
  });
  for (const s of [
    "hello",
    "TOP: https://bad.example\nBOTTOM: x",
    "TOP: @all\nBOTTOM: x",
    `TOP: ${"a".repeat(81)}\nBOTTOM: x`,
    "TOP: x\nBOTTOM: y\nextra",
  ])
    expect(() => parseMeme(s)).toThrow();
  expect(memeFingerprint("TOP: quick fix!\nBOTTOM: Six new dependencies")).toBe(
    memeFingerprint("TOP: QUICK FIX\nBOTTOM: six new dependencies."),
  );
});
test("Belle schedules all night, once per 18 minutes, only in topic 13", async () => {
  const t = await setup();
  const id = await t.mutation(internal.telegramMemes.start, {});
  expect(id).not.toBeNull();
  expect(await t.mutation(internal.telegramMemes.start, {})).toBeNull();
  vi.advanceTimersByTime(10 * 60_000);
  expect(await t.mutation(internal.telegramMemes.start, {})).toBeNull();
  vi.advanceTimersByTime(8 * 60_000);
  expect(await t.mutation(internal.telegramMemes.start, {})).not.toBeNull();
  const rows = await t.query(internal.telegramMemes.inspect, {});
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.topicId === 13)).toBe(true);
});
test("kill switch, wrong topic, unavailable agent and external injection fail closed", async () => {
  const t = await setup();
  vi.stubEnv("TELEGRAM_MEMES_TOPIC_ID", "9");
  expect(await t.mutation(internal.telegramMemes.start, {})).toBeNull();
  vi.stubEnv("TELEGRAM_MEMES_TOPIC_ID", "13");
  vi.stubEnv("TELEGRAM_MEMES_ENABLED", "false");
  expect(await t.mutation(internal.telegramMemes.start, {})).toBeNull();
  expect(
    await t.mutation(internal.telegramAgents.accept, {
      agentSlug: "belle",
      botId: "123456789",
      updateId: 1,
      messageId: 1,
      topicId: 13,
      senderId: "1234",
      text: "foo",
      kind: "meme",
    }),
  ).toBe(false);
});
test("duplicate captions and uncertain sends cannot be replayed", async () => {
  const t = await setup();
  const id = (await t.mutation(internal.telegramMemes.start, {}))!;
  expect(
    await t.mutation(internal.telegramAgents.claim, { requestId: id }),
  ).toBe(true);
  expect(
    await t.mutation(internal.telegramMemes.reserveCaption, {
      requestId: id,
      text: "TOP: quick fix\nBOTTOM: six dependencies",
    }),
  ).toBe(true);
  await t.mutation(internal.telegramAgents.ready, {
    requestId: id,
    name: "Belle",
    text: "TOP: quick fix\nBOTTOM: six dependencies",
  });
  expect(
    await t.mutation(internal.telegramAgents.claimDelivery, { requestId: id }),
  ).toBe(true);
  await t.mutation(internal.telegramAgents.finish, {
    requestId: id,
    reason: "delivery_unconfirmed",
  });
  expect(
    await t.mutation(internal.telegramAgents.claim, { requestId: id }),
  ).toBe(false);
  expect(
    await t.mutation(internal.telegramAgents.claimDelivery, { requestId: id }),
  ).toBe(false);
  vi.advanceTimersByTime(MEME_INTERVAL_MS);
  const next = (await t.mutation(internal.telegramMemes.start, {}))!;
  await t.mutation(internal.telegramAgents.claim, { requestId: next });
  expect(
    await t.mutation(internal.telegramMemes.reserveCaption, {
      requestId: next,
      text: "TOP: QUICK FIX!\nBOTTOM: six dependencies.",
    }),
  ).toBe(false);
});
test("expired work remains held and never sends after the time limit", async () => {
  const t = await setup();
  const id = (await t.mutation(internal.telegramMemes.start, {}))!;
  vi.advanceTimersByTime(8 * 60_000);
  expect(
    await t.mutation(internal.telegramAgents.claim, { requestId: id }),
  ).toBe(false);
  await t.mutation(internal.telegramMemes.expire, { requestId: id });
  expect((await t.query(internal.telegramMemes.inspect, {}))[0]).toMatchObject({
    status: "held",
    reason: "meme_execution_unconfirmed",
  });
});
