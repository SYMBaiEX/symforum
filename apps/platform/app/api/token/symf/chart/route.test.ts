// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET } from "./route";
import { SYMF_TOKEN } from "@/lib/symf-token";
import { parseSymfCandles, SYMF_CHART_INTERVALS } from "@/lib/symf-market-data";

const shared = vi.hoisted(() => ({ respond: vi.fn() }));
vi.mock("@/lib/terminal-market-route", () => ({
  terminalMarketResponse: shared.respond,
}));

function market(mint = SYMF_TOKEN.mint as string) {
  return {
    meta: {
      base: { address: mint },
      quote: { address: "So11111111111111111111111111111111111111112" },
    },
    data: {
      attributes: {
        ohlcv_list: [
          [1000, 0.00002, 0.00004, 0.00001, 0.00003, 25],
          [500, 0.00001, 0.00003, 0.00001, 0.00002, 10],
        ],
      },
    },
  };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

test.each([
  "",
  "?interval=1m",
  "?interval=5m",
  "?interval=15m",
  "?interval=1h",
  "?interval=4h",
])(
  "legacy chart forwards %s unchanged to the shared fixed-pool cache",
  async (search) => {
    const cached = Response.json({
      mint: SYMF_TOKEN.mint,
      pool: SYMF_TOKEN.pool,
    });
    shared.respond.mockResolvedValue(cached);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const request = new Request(
      `https://forum.symbaiex.com/api/token/symf/chart${search}`,
    );
    expect(await GET(request)).toBe(cached);
    expect(shared.respond).toHaveBeenCalledExactlyOnceWith(
      SYMF_TOKEN.mint,
      "chart",
      request,
      { pinnedSymf: true },
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

test.each([
  ["1m", "1"],
  ["5m", "5"],
] as const)("%s preserves exact minute aggregation", (interval, aggregate) => {
  expect(SYMF_CHART_INTERVALS[interval]).toEqual({
    timeframe: "minute",
    aggregate,
  });
});

test.each([400, 429, 503])(
  "shared rejection %s is returned without an alternate provider fetch",
  async (status) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const denied = Response.json(
      { state: "unavailable" },
      {
        status,
        headers: { "Cache-Control": "no-store", "Retry-After": "120" },
      },
    );
    shared.respond.mockResolvedValue(denied);
    const request = new Request(
      "https://forum.symbaiex.com/api/token/symf/chart?interval=https://other.example",
    );
    expect(await GET(request)).toBe(denied);
    expect(shared.respond).toHaveBeenCalledExactlyOnceWith(
      SYMF_TOKEN.mint,
      "chart",
      request,
      { pinnedSymf: true },
    );
    expect(denied.headers.get("retry-after")).toBe("120");
    expect(fetcher).not.toHaveBeenCalled();
  },
);

test("fixed-mint parser rejects substituted token and quote identities and preserves ordered USD candles", () => {
  expect(() => parseSymfCandles(market("another-mint"), Date.now())).toThrow(
    "wrong_market_token",
  );
  const wrongQuote = market();
  wrongQuote.meta.quote.address = "another-quote";
  expect(() => parseSymfCandles(wrongQuote, Date.now())).toThrow(
    "wrong_market_token",
  );
  expect(
    parseSymfCandles(market(), Date.now()).map((candle) => candle.time),
  ).toEqual([500, 1000]);
});

test("invalid OHLC bounds, duplicate times and future candles cannot enter the chart", () => {
  const bad = market();
  bad.data.attributes.ohlcv_list[0][2] = 0.000001;
  expect(() => parseSymfCandles(bad, Date.now())).toThrow();
  const duplicate = market();
  duplicate.data.attributes.ohlcv_list[0][0] = 500;
  expect(() => parseSymfCandles(duplicate, Date.now())).toThrow();
  expect(() => parseSymfCandles(market(), 100)).toThrow();
});
