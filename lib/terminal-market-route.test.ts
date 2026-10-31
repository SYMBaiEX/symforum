// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { terminalMarketResponse } from "./terminal-market-route";
import { SYMF_TOKEN } from "./symf-token";
import { MARKET_QUOTES } from "./terminal-market-source";
import {
  CHART_CACHE_RETENTION_MS,
  type MarketCacheView,
} from "./chart-cache-policy";

const { action } = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    action = action;
  },
}));
const now = Date.UTC(2026, 9, 31, 2);
const request = () =>
  new Request("https://forum.symbaiex.com/api/token/test/chart?interval=15m");
const payload = (checkedAt = now) =>
  JSON.stringify({
    mint: SYMF_TOKEN.mint,
    pool: SYMF_TOKEN.pool,
    quote: MARKET_QUOTES[0],
    interval: "15m",
    checkedAt,
    candles: [{ time: now / 1000, close: 1 }],
  });
function view(overrides: Partial<MarketCacheView> = {}): MarketCacheView {
  return {
    state: "ready",
    payload: payload(),
    stale: false,
    cache: {
      lastSuccessAt: now,
      lastAttemptAt: now,
      nextRetryAt: now + 300_000,
      failureCount: 0,
      failureStage: null,
      failureCode: null,
    },
    ...overrides,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://strong-bee-384.convex.cloud");
  action.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("fresh response forwards safe cache metadata and never extends freshness via CDN", async () => {
  action.mockResolvedValue(view({ payload: payload(now - 295_000) }));
  const response = await terminalMarketResponse(
    SYMF_TOKEN.mint,
    "chart",
    request(),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=5, s-maxage=5, must-revalidate",
  );
  expect(response.headers.get("retry-after")).toBe("300");
  expect(await response.json()).toMatchObject({
    state: "ready",
    stale: false,
    checkedAt: now - 295_000,
    cache: { nextRetryAt: now + 300_000 },
  });
});

test("provider failure retains original data and server backoff without caching stale flags", async () => {
  const cache = {
    lastSuccessAt: now - 600_000,
    lastAttemptAt: now,
    nextRetryAt: now + 900_000,
    failureCount: 5,
    failureStage: "candles" as const,
    failureCode: "http-429" as const,
  };
  action.mockResolvedValue(
    view({
      payload: payload(now - 600_000),
      stale: true,
      state: "deferred",
      cache,
    }),
  );
  const response = await terminalMarketResponse(
    SYMF_TOKEN.mint,
    "chart",
    request(),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("retry-after")).toBe("900");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    checkedAt: now - 600_000,
    stale: true,
    cache,
  });
});

test("age overrides an accidentally fresh flag and retention-expired payload is never exposed", async () => {
  action
    .mockResolvedValueOnce(view({ payload: payload(now - 300_000) }))
    .mockResolvedValueOnce(
      view({ payload: payload(now - CHART_CACHE_RETENTION_MS) }),
    );
  expect(
    await (
      await terminalMarketResponse(SYMF_TOKEN.mint, "chart", request())
    ).json(),
  ).toMatchObject({ stale: true, checkedAt: now - 300_000 });
  const expired = await terminalMarketResponse(
    SYMF_TOKEN.mint,
    "chart",
    request(),
  );
  expect(expired.status).toBe(503);
  expect(await expired.json()).not.toHaveProperty("candles");
});

test.each([
  ["budget", 429],
  ["loading", 503],
  ["deferred", 503],
  ["unavailable", 503],
  ["unsupported", 404],
] as const)(
  "%s preserves typed state and retry deadline",
  async (state, status) => {
    const cache = {
      ...view().cache,
      nextRetryAt: state === "unsupported" ? null : now + 7_200_000,
    };
    action.mockResolvedValue(view({ state, payload: null, cache }));
    const response = await terminalMarketResponse(
      SYMF_TOKEN.mint,
      "chart",
      request(),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("retry-after")).toBe(
      state === "unsupported" ? null : "7200",
    );
    expect(await response.json()).toMatchObject({ state, cache });
  },
);

test("local admission exhaustion identifies the platform allowance without blaming a provider", async () => {
  const cache: MarketCacheView["cache"] = {
    ...view().cache,
    nextRetryAt: now + 7_200_000,
    failureStage: "admission",
    failureCode: "budget",
    failureProvider: null,
  };
  action.mockResolvedValue(view({ state: "budget", payload: null, cache }));
  const response = await terminalMarketResponse(
    SYMF_TOKEN.mint,
    "chart",
    request(),
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("7200");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body).toEqual({
    error:
      "Platform market-data allowance reached. Cached forum coverage remains available.",
    state: "budget",
    cache,
  });
  expect(body.error).not.toMatch(/free-tier|helius|jupiter/i);
  expect(action).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    mint: SYMF_TOKEN.mint,
    kind: "chart",
    interval: "15m",
    pinnedSymf: true,
  });
});

test("a local candle budget does not promise a daily reset or imply a provider rejection", async () => {
  const cache: MarketCacheView["cache"] = {
    ...view().cache,
    nextRetryAt: now + 86_400_000,
    failureStage: "candles",
    failureCode: "budget",
    failureProvider: "solana-tracker",
  };
  action.mockResolvedValue(view({ state: "budget", payload: null, cache }));
  const response = await terminalMarketResponse(
    SYMF_TOKEN.mint,
    "chart",
    request(),
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("86400");
  const body = await response.json();
  expect(body).toEqual({
    error:
      "Platform market-data allowance reached. Cached forum coverage remains available.",
    state: "budget",
    cache,
  });
  expect(body.error).not.toMatch(/daily|free-tier|helius|jupiter/i);
  expect(action).toHaveBeenCalledTimes(1);
});

test("a recorded provider 429 stays distinct from the platform admission cap", async () => {
  const cache: MarketCacheView["cache"] = {
    ...view().cache,
    nextRetryAt: now + 900_000,
    failureStage: "candles",
    failureCode: "http-429",
    failureProvider: "geckoterminal",
  };
  action.mockResolvedValue(view({ state: "unavailable", payload: null, cache }));
  const response = await terminalMarketResponse(
    SYMF_TOKEN.mint,
    "chart",
    request(),
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("900");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    error: "No current chart is available for this indexed token.",
    state: "unavailable",
    cache,
  });
  expect(action).toHaveBeenCalledTimes(1);
});

test("unexpected failures expose only fixed diagnostics, not provider contents or errors", async () => {
  action.mockRejectedValue(new Error("secret-provider-body-and-url"));
  const response = await terminalMarketResponse(
    SYMF_TOKEN.mint,
    "chart",
    request(),
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("60");
  const body = await response.text();
  expect(body).not.toContain("secret-provider");
  expect(JSON.parse(body)).toMatchObject({
    state: "unavailable",
    cache: {
      failureStage: "cache",
      failureCode: "invalid-response",
      nextRetryAt: now + 60_000,
    },
  });
});

test("identity mismatch fails closed, and invalid arguments never invoke Convex", async () => {
  action.mockResolvedValue(
    view({ payload: payload().replace(SYMF_TOKEN.mint, "wrong-mint") }),
  );
  expect(
    (await terminalMarketResponse(SYMF_TOKEN.mint, "chart", request())).status,
  ).toBe(503);
  action.mockClear();
  expect(
    (await terminalMarketResponse("bad-mint", "chart", request())).status,
  ).toBe(400);
  expect(action).not.toHaveBeenCalled();
});

test("pinned legacy chart requests use the distinct fixed-pool server path", async () => {
  action.mockResolvedValue(view());
  await terminalMarketResponse(SYMF_TOKEN.mint, "chart", request(), {
    pinnedSymf: true,
  });
  expect(action).toHaveBeenCalledWith(expect.anything(), {
    mint: SYMF_TOKEN.mint,
    kind: "chart",
    interval: "15m",
    pinnedSymf: true,
  });
});

test("both website SYMF chart URLs use the canonical pinned cache, ignoring caller overrides", async () => {
  action.mockResolvedValue(view());
  const input = new Request(
    `https://forum.symbaiex.com/api/token/${SYMF_TOKEN.mint}/chart?interval=15m&pinnedSymf=false&pool=untrusted&provider=untrusted`,
  );
  const response = await terminalMarketResponse(
    SYMF_TOKEN.mint,
    "chart",
    input,
  );
  expect(response.status).toBe(200);
  expect(action).toHaveBeenCalledWith(expect.anything(), {
    mint: SYMF_TOKEN.mint,
    kind: "chart",
    interval: "15m",
    pinnedSymf: true,
  });
});

test.each(["pool", "quote"])(
  "canonical SYMF responses reject an incorrect %s",
  async (field) => {
    action.mockResolvedValue(
      view({
        payload: JSON.stringify({
          ...JSON.parse(payload()),
          [field]: "untrusted",
        }),
      }),
    );
    const response = await terminalMarketResponse(
      SYMF_TOKEN.mint,
      "chart",
      request(),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("candles");
  },
);

test("other token chart routes keep dynamic-pool behavior", async () => {
  const otherMint = MARKET_QUOTES[1];
  action.mockResolvedValue(
    view({
      payload: JSON.stringify({ ...JSON.parse(payload()), mint: otherMint }),
    }),
  );
  const response = await terminalMarketResponse(otherMint, "chart", request());
  expect(response.status).toBe(200);
  expect(action).toHaveBeenCalledWith(expect.anything(), {
    mint: otherMint,
    kind: "chart",
    interval: "15m",
  });
  action.mockClear();
  action.mockResolvedValue(view());
  await terminalMarketResponse(SYMF_TOKEN.mint, "market", request());
  expect(action).toHaveBeenCalledWith(expect.anything(), {
    mint: SYMF_TOKEN.mint,
    kind: "market",
    interval: "15m",
  });
});
