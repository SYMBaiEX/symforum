// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET } from "./route";
import { terminalMarketResponse } from "@/lib/terminal-market-route";
import { SYMF_TOKEN } from "@/lib/symf-token";
import { MARKET_QUOTES } from "@/lib/terminal-market-source";
import { SymfStats } from "@/components/forum/symf-market-overview";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const { action } = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    action = action;
  },
}));
const now = Date.parse("2026-10-31T18:00:00Z");
const request = () =>
  new Request("https://forum.symbaiex.com/api/token/symf/market");
const cache = {
  lastSuccessAt: now,
  lastAttemptAt: now,
  nextRetryAt: now + 300000,
  failureCount: 0,
  failureStage: null,
  failureCode: null,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://fixture.convex.cloud");
  action.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Direct provider transport forbidden");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
test("legacy official overview delegates exclusively to the shared pinned-market action", async () => {
  action.mockResolvedValue({
    state: "ready",
    stale: false,
    cache,
    payload: JSON.stringify({
      mint: SYMF_TOKEN.mint,
      pool: SYMF_TOKEN.pool,
      quote: MARKET_QUOTES[0],
      checkedAt: now,
      marketCheckedAt: now - 2000,
      stats: { marketCap: null, fdv: 10, liquidity: 20, volume24h: 0 },
      trades: [],
    }),
  });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(action).toHaveBeenCalledWith(expect.anything(), {
    mint: SYMF_TOKEN.mint,
    kind: "market",
    interval: "15m",
    pinnedSymf: true,
  });
  expect(await response.json()).toMatchObject({
    checkedAt: now,
    marketCheckedAt: now - 2000,
    stats: { marketCap: null, volume24h: 0 },
    trades: [],
    state: "ready",
    cache,
  });
  await terminalMarketResponse(SYMF_TOKEN.mint, "market", request(), {
    pinnedSymf: true,
  });
  expect(action.mock.calls[0][1]).toEqual(action.mock.calls[1][1]);
  expect(fetch).not.toHaveBeenCalled();
});
test("a mismatched official pool is rejected without falling back to direct providers", async () => {
  action.mockResolvedValue({
    state: "ready",
    stale: false,
    cache,
    payload: JSON.stringify({
      mint: SYMF_TOKEN.mint,
      pool: MARKET_QUOTES[1],
      quote: MARKET_QUOTES[0],
      checkedAt: now,
      stats: null,
      trades: [],
    }),
  });
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetch).not.toHaveBeenCalled();
});

test("the stats label uses original market observation time and only legacy payloads fall back to checkedAt", () => {
  const original = now - 120000;
  const data = {
    checkedAt: now,
    marketCheckedAt: original,
    stats: { marketCap: null, fdv: 10, liquidity: 20, volume24h: 0 },
    trades: null,
  };
  const text = (time: number) =>
    new Date(time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  const html = renderToStaticMarkup(
    createElement(SymfStats, { data, failed: false }),
  );
  expect(html).toContain(`Checked ${text(original)}`);
  expect(html).not.toContain(`Checked ${text(now)}`);
  const { marketCheckedAt: ignored, ...legacy } = data;
  void ignored;
  expect(
    renderToStaticMarkup(
      createElement(SymfStats, { data: legacy, failed: false }),
    ),
  ).toContain(`Checked ${text(now)}`);
});
