// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { GET } from "./route";
import { SYMF_TOKEN } from "@/lib/symf-token";
import { parseSymfStats, parseSymfTrades } from "@/lib/symf-market-overview";
const { action } = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    action = action;
  },
}));

const quote = "So11111111111111111111111111111111111111112";
function stats() {
  return [
    {
      chainId: "solana",
      pairAddress: SYMF_TOKEN.pool,
      baseToken: { address: SYMF_TOKEN.mint },
      quoteToken: { address: quote },
      marketCap: 12000,
      fdv: 18000,
      liquidity: { usd: 7000 },
      volume: { h24: 3000 },
    },
  ];
}
function trade(side: "buy" | "sell" = "buy", id = "one") {
  return {
    id: `solana_${id}`,
    attributes: {
      kind: side,
      block_timestamp: "2026-10-27T12:00:00Z",
      tx_hash: "a".repeat(88),
      from_token_address: side === "buy" ? quote : SYMF_TOKEN.mint,
      to_token_address: side === "buy" ? SYMF_TOKEN.mint : quote,
      from_token_amount: "100",
      to_token_amount: "200",
      volume_in_usd: "0.001",
      price_to_in_usd: "0.00001",
      price_from_in_usd: "0.00002",
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  action.mockReset();
});

test("reported market cap and FDV stay distinct; missing market cap is never replaced by FDV", () => {
  expect(parseSymfStats(stats())).toMatchObject({
    marketCap: 12000,
    fdv: 18000,
  });
  const input = stats() as Array<Record<string, unknown>>;
  delete input[0].marketCap;
  expect(parseSymfStats(input)).toMatchObject({ marketCap: null, fdv: 18000 });
  input[0].pairAddress = "another-pool";
  expect(() => parseSymfStats(input)).toThrow();
});

test("trades accept buys and sells without an amount minimum and reject unrelated mints or duplicate events", () => {
  const other = trade("buy", "other");
  other.attributes.to_token_address = "other-mint";
  const rows = [trade(), trade(), trade("sell", "two"), other];
  const result = parseSymfTrades({ data: rows }, Date.now());
  expect(result).toHaveLength(2);
  expect(result.map((x) => x.side)).toEqual(["buy", "sell"]);
  expect(result[0]).toMatchObject({
    valueUsd: 0.001,
    amount: 200,
    priceUsd: 0.00001,
  });
  expect(result[1]).toMatchObject({ amount: 100, priceUsd: 0.00002 });
});

test("overview can serve trades during a stats outage and returns only the bounded public trade fields", async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.includes("dexscreener")
      ? new Response("unavailable", { status: 503 })
      : Response.json({ data: [trade()] }),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://fixture.convex.cloud");
  action.mockResolvedValue({
    state: "ready",
    stale: false,
    cache: {
      lastSuccessAt: Date.now(),
      lastAttemptAt: Date.now(),
      nextRetryAt: Date.now() + 60000,
      failureCount: 0,
      failureStage: "pool",
      failureCode: "http-5xx",
    },
    payload: JSON.stringify({
      mint: SYMF_TOKEN.mint,
      pool: SYMF_TOKEN.pool,
      quote,
      checkedAt: Date.now(),
      stats: null,
      trades: parseSymfTrades({ data: [trade()] }, Date.now()),
    }),
  });
  const response = await GET(
    new Request("https://forum.symbaiex.com/api/token/symf/market"),
  );
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.stats).toBeNull();
  expect(data.trades).toHaveLength(1);
  expect(data.trades[0]).not.toHaveProperty("tx_from_address");
  expect(
    fetcher.mock.calls.every(
      ([url]) => url.includes(SYMF_TOKEN.mint) || url.includes(SYMF_TOKEN.pool),
    ),
  ).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  expect(action).toHaveBeenCalledTimes(1);
});

test("a total provider outage does not manufacture empty trades or zero market cap", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("limited", { status: 429 })),
  );
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://fixture.convex.cloud");
  action.mockResolvedValue({
    state: "unavailable",
    payload: null,
    stale: false,
    cache: {
      lastSuccessAt: null,
      lastAttemptAt: Date.now(),
      nextRetryAt: Date.now() + 60000,
      failureCount: 1,
      failureStage: "trades",
      failureCode: "http-429",
    },
  });
  const response = await GET(
    new Request("https://forum.symbaiex.com/api/token/symf/market"),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("stats");
  expect(response.headers.get("retry-after")).toBe("60");
});
