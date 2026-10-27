// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  SYMF_MINT,
  poolBuys,
  symfPools,
  renderFeedBuys,
} from "../lib/telegram-trade-feed";
const modules = import.meta.glob("./**/*.ts");
const pool = "BqkubRUbgk13q1imaVhKkSVZqrBoVXGc5LJi8JCL8CZr",
  now = Date.parse("2026-10-27T19:20:00Z");
const raw = (id = "trade_1", overrides = {}) => ({
  id,
  attributes: {
    block_timestamp: new Date(now - 1000).toISOString(),
    tx_hash: "1".repeat(88),
    kind: "buy",
    to_token_address: SYMF_MINT,
    from_token_address: "So11111111111111111111111111111111111111112",
    to_token_amount: "100.0000001",
    from_token_amount: "0.00000001",
    volume_in_usd: "0.0001",
    is_anomalous: true,
    ...overrides,
  },
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("TELEGRAM_TRADE_FEED_ENABLED", "true");
  vi.stubEnv("TELEGRAM_TRADE_FEED_TOPIC_ID", "310");
  vi.stubEnv("TELEGRAM_AGENTS_ENABLED", "true");
  vi.stubEnv(
    "TELEGRAM_AGENT_BOTS",
    JSON.stringify({
      suki: {
        token: `123456789:${"a".repeat(35)}`,
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
function setup() {
  const t = convexTest(schema, modules);
  register(t);
  return t;
}
function transport(result: "ok" | "timeout" | "wrong-topic" = "ok") {
  const sends: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/tokens/"))
        return Response.json({
          data: [
            {
              attributes: { address: pool },
              relationships: {
                base_token: { data: { id: `solana_${SYMF_MINT}` } },
              },
            },
          ],
        });
      if (url.includes("/pools/")) return Response.json({ data: [raw()] });
      if (url.endsWith("sendMessage")) {
        sends.push(JSON.parse(String(init?.body)));
        if (result === "timeout") throw Error("timeout");
        return Response.json({
          ok: true,
          result: {
            message_id: 400,
            message_thread_id: result === "wrong-topic" ? 9 : 310,
            chat: { id: -1004387387301 },
          },
        });
      }
      throw Error("unexpected_transport");
    }),
  );
  return sends;
}
test("keeps dust and flagged buys, including reverse provider directions; excludes sells and wrong mint", () => {
  const data = {
    data: [
      raw(),
      raw("trade_2", { kind: "sell" }),
      raw("sell", {
        to_token_address: "So11111111111111111111111111111111111111112",
        from_token_address: SYMF_MINT,
      }),
      raw("wrong", { to_token_address: "another" }),
    ],
  };
  const r = poolBuys(data, pool, now - 5000, now);
  expect(r.buys).toHaveLength(2);
  expect(r.buys[0].anomalous).toBe(true);
  const text = renderFeedBuys(r.buys);
  expect(text).toContain("&lt;$0.01");
  expect(text).toContain("&lt;0.000001 SOL");
  expect(text).not.toContain("NaN");
  expect(text).toContain("View transaction");
});
test("rejects malformed provider payloads and mismatched pool discovery", () => {
  expect(() =>
    poolBuys(
      { data: [raw("bad", { tx_hash: "javascript:alert(1)" })] },
      pool,
      0,
      now,
    ),
  ).toThrow();
  expect(() =>
    poolBuys(
      { data: [raw("bad", { block_timestamp: "tomorrow" })] },
      pool,
      0,
      now,
    ),
  ).toThrow();
  expect(
    symfPools({
      data: [
        {
          attributes: { address: pool },
          relationships: { base_token: { data: { id: "solana_wrong" } } },
        },
      ],
    }).pools,
  ).toEqual([]);
});
test("quiet exact-topic delivery is deduplicated across repeated provider polls", async () => {
  const t = setup(),
    sends = transport();
  await t.action(internal.telegramTradeFeedPoll.poll, {});
  await t.action(internal.telegramTradeFeedPoll.poll, {});
  vi.advanceTimersByTime(60001);
  await t.action(internal.telegramTradeFeedPoll.poll, {});
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({
    chat_id: "-1004387387301",
    message_thread_id: 310,
    disable_notification: true,
  });
  const state = await t.query(internal.telegramTradeFeed.inspect, {});
  expect(state.batches[0]).toMatchObject({ status: "sent", messageId: 400 });
  expect(state.pending).toBe(0);
});
test.each(["timeout", "wrong-topic"] as const)(
  "holds %s without replaying the send",
  async (result) => {
    const t = setup(),
      sends = transport(result);
    await t.action(internal.telegramTradeFeedPoll.poll, {});
    vi.advanceTimersByTime(60001);
    await t.action(internal.telegramTradeFeedPoll.poll, {});
    expect(sends).toHaveLength(1);
    expect(
      (await t.query(internal.telegramTradeFeed.inspect, {})).batches[0].status,
    ).toBe("held");
  },
);
test("wrong topic and disabled switches fail closed", async () => {
  const t = setup(),
    sends = transport();
  vi.stubEnv("TELEGRAM_TRADE_FEED_TOPIC_ID", "9");
  await t.action(internal.telegramTradeFeedPoll.poll, {});
  expect(sends).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
  vi.stubEnv("TELEGRAM_TRADE_FEED_TOPIC_ID", "310");
  vi.stubEnv("TELEGRAM_TRADE_FEED_ENABLED", "false");
  await t.action(internal.telegramTradeFeedPoll.poll, {});
  expect(fetch).not.toHaveBeenCalled();
});
test("history gaps remain visible and do not cause old deliveries to replay", async () => {
  const t = setup();
  await t.mutation(internal.telegramTradeFeed.begin, {});
  await t.mutation(internal.telegramTradeFeed.record, {
    pool,
    ...poolBuys({ data: [raw()] }, pool, 0, now),
  });
  vi.advanceTimersByTime(60000);
  await t.mutation(internal.telegramTradeFeed.record, {
    pool,
    ...poolBuys(
      {
        data: [
          raw("new", { block_timestamp: new Date(now + 30000).toISOString() }),
        ],
      },
      pool,
      0,
      now + 60000,
    ),
  });
  const state = await t.query(internal.telegramTradeFeed.inspect, {});
  expect(state.state?.coverageWarning).toBe(true);
  const batch = await t.mutation(internal.telegramTradeFeed.claim, {});
  expect(batch?.text).toContain("coverage gap");
});

test("honors provider 429 backoff before making another data request", async () => {
  const t = setup();
  const requests = vi.fn(
    async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "600" },
      }),
  );
  vi.stubGlobal("fetch", requests);
  await t.action(internal.telegramTradeFeedPoll.poll, {});
  expect(requests).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5 * 60_000);
  await t.action(internal.telegramTradeFeedPoll.poll, {});
  expect(requests).toHaveBeenCalledTimes(1);
  const state = await t.query(internal.telegramTradeFeed.inspect, {});
  expect(state.state?.reason).toBe("provider_http_429");
  expect(state.state?.retryAfterAt).toBe(now + 600_000);
  vi.advanceTimersByTime(300_001);
  await t.action(internal.telegramTradeFeedPoll.poll, {});
  expect(requests).toHaveBeenCalledTimes(2);
});
