// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { GET } from "./route";
import { SYMF_TOKEN } from "@/lib/symf-token";
import { parseSymfCandles } from "@/lib/symf-market-data";

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
afterEach(() => vi.unstubAllGlobals());

test.each([
  ["1m", "1"],
  ["5m", "5"],
])(
  "%s candles use the provider's exact minute aggregation",
  async (interval, aggregate) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(market()));
    vi.stubGlobal("fetch", fetcher);
    expect(
      (
        await GET(
          new Request(
            `https://forum.symbaiex.com/api/token/symf/chart?interval=${interval}`,
          ),
        )
      ).status,
    ).toBe(200);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.pathname).toContain("/ohlcv/minute");
    expect(url.searchParams.get("aggregate")).toBe(aggregate);
  },
);

test("public chart fetches only the fixed verified pool and returns ordered USD candles with bounded caching", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(market()));
  vi.stubGlobal("fetch", fetcher);
  const response = await GET(
    new Request("https://forum.symbaiex.com/api/token/symf/chart?interval=1h"),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.mint).toBe(SYMF_TOKEN.mint);
  expect(body.candles.map((c: { time: number }) => c.time)).toEqual([
    500, 1000,
  ]);
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.pathname).toBe(
    `/api/v2/networks/solana/pools/${SYMF_TOKEN.pool}/ohlcv/hour`,
  );
  expect(url.searchParams.get("currency")).toBe("usd");
  expect(url.searchParams.get("aggregate")).toBe("1");
  expect(fetcher.mock.calls[0][1].next.revalidate).toBe(60);
  expect(response.headers.get("cache-control")).toContain("s-maxage=60");
});

test("unrecognized intervals cannot select arbitrary upstream requests", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(
    (
      await GET(
        new Request(
          "https://forum.symbaiex.com/api/token/symf/chart?interval=https://other.example",
        ),
      )
    ).status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

test("wrong-token and unavailable-provider results fail without invented or substituted prices", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json(market("another-mint"))),
  );
  let response = await GET(
    new Request("https://forum.symbaiex.com/api/token/symf/chart"),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("candles");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })),
  );
  response = await GET(
    new Request("https://forum.symbaiex.com/api/token/symf/chart"),
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("60");
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
