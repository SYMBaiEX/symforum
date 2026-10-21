import { afterEach, describe, expect, test, vi } from "vitest";
import { enrichTokenSnapshot, fetchTokenRankings } from "./solana-tracker";

const NOW = Date.UTC(2026, 9, 21, 20);
const KEY = "test-key-never-published";
const SYMF = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
const KIMCHI = "CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump";

function mint(lastByte: number): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = (1n << 248n) + BigInt(lastByte);
  let encoded = "";
  while (value) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return encoded;
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mint: SYMF,
    name: "Example",
    symbol: "EX",
    decimals: 6,
    priceUsd: 0.00002,
    marketCapUsd: 20_000,
    liquidityUsd: 10_000,
    holders: 50,
    volume_1h: 5_000,
    lastUpdated: NOW - 60_000,
    launchpad: { name: "BAGS", url: "https://bags.fm/" },
    market: "meteora-dyn-v2",
    image: "https://assets.example.com/image.png",
    socials: {
      website: "https://example.com/",
      twitter: "https://x.com/example",
      telegram: "https://t.me/example",
    },
    events: { "1h": { priceChangePercentage: -3.5 } },
    ...overrides,
  };
}

function setup(rows: unknown[] = [row()]) {
  const reserveRequest = vi.fn(async () => true);
  const fetch = vi.fn<typeof globalThis.fetch>();
  fetch.mockResolvedValue(Response.json({ status: "success", data: rows }));
  vi.stubGlobal("fetch", fetch);
  return {
    reserveRequest,
    fetch,
    apiKey: KEY,
    platform: "bags" as const,
    now: NOW,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Solana Tracker eligible indexed rankings", () => {
  test("uses one reserved, fixed-origin, nonredirecting request with exact search parameters", async () => {
    const options = setup();
    const result = await fetchTokenRankings(options);
    expect(options.reserveRequest).toHaveBeenCalledOnce();
    expect(options.fetch).toHaveBeenCalledOnce();
    expect(options.fetch).toHaveBeenCalledWith(
      "https://data.solanatracker.io/search?launchpad=bags&sortBy=volume_1h&sortOrder=desc&limit=30&showPriceChanges=true",
      expect.objectContaining({
        redirect: "error",
        headers: { "x-api-key": KEY, accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result[0]).toMatchObject({
      mint: SYMF,
      sourceRank: 1,
      priceUsd: 0.00002,
      metricsAsOf: NOW - 60_000,
      observedAt: NOW,
      priceChange1hPercent: -3.5,
      sourceUrl: `https://www.solanatracker.io/token/${SYMF}`,
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(result[0].warnings?.join(" ")).toContain(
      "not the platform-wide top five",
    );
    expect(result[0].warnings?.join(" ")).toContain(
      "Original Bags graduates may be missing",
    );
  });

  test("never fetches when reservation is denied", async () => {
    const options = setup();
    options.reserveRequest.mockResolvedValue(false);
    expect(await fetchTokenRankings(options)).toEqual([]);
    expect(options.fetch).not.toHaveBeenCalled();
  });

  test("filters corrupt addresses and known system/program addresses even with real-looking metrics", async () => {
    const invalid = [
      "A".repeat(32),
      "z".repeat(44),
      "0".repeat(44),
      `${SYMF} `,
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "ComputeBudget111111111111111111111111111111",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    ];
    const options = setup(
      invalid.map((address) => row({ mint: address })).concat([row()]),
    );
    expect(
      (await fetchTokenRankings(options)).map((token) => token.mint),
    ).toEqual([SYMF]);
  });

  test.each([
    { lastUpdated: NOW - 900_001 },
    { lastUpdated: NOW + 60_001 },
    { lastUpdated: NOW / 1_000 },
    { lastUpdated: "current" },
    { lastUpdated: null },
    { name: " " },
    { symbol: "" },
    { name: "\u200b\u202e" },
    { symbol: "\u0000\u2060" },
    { decimals: "6" },
    { decimals: -1 },
    { decimals: 256 },
    { decimals: 1.1 },
    { priceUsd: 0 },
    { priceUsd: -1 },
    { priceUsd: "1" },
    { marketCapUsd: -5 },
    { liquidityUsd: null },
    { liquidityUsd: 0 },
    { holders: 0 },
    { holders: 1.1 },
    { holders: -1 },
    { holders: Number.MAX_SAFE_INTEGER + 1 },
    { volume_1h: -1 },
    { volume_1h: 0 },
    { volume_1h: null },
  ])(
    "rejects invalid, missing, stale or future numeric data: %j",
    async (overrides) => {
      expect(await fetchTokenRankings(setup([row(overrides)]))).toEqual([]);
    },
  );

  test("accepts timestamp boundaries without replacing source time with retrieval time", async () => {
    const options = setup([
      row({ lastUpdated: NOW - 900_000 }),
      row({ mint: KIMCHI, lastUpdated: NOW + 60_000 }),
    ]);
    expect(
      (await fetchTokenRankings(options))
        .map((token) => token.metricsAsOf)
        .sort(),
    ).toEqual([NOW - 900_000, NOW + 60_000]);
  });

  test("requires explicit Bags origin rather than suffix, current market, or server filter alone", async () => {
    const options = setup([
      row({ mint: mint(1), launchpad: null }),
      row({
        mint: mint(2),
        launchpad: { name: "Other", url: "https://bags.fm.evil.com/" },
      }),
      row({ mint: mint(3), launchpad: { name: "bags" } }),
      row({
        mint: mint(4),
        launchpad: { name: "", url: "https://bags.fm/abc" },
      }),
    ]);
    expect(
      (await fetchTokenRankings(options)).map((token) => token.mint).sort(),
    ).toEqual([mint(3), mint(4)].sort());
  });

  test("Pump accepts explicit origin and unlabelled native markets, never another launchpad", async () => {
    const options = setup([
      row({
        mint: mint(1),
        launchpad: { name: "Pump.fun" },
        market: "raydium",
      }),
      row({ mint: mint(2), launchpad: {}, market: "pumpfun" }),
      row({ mint: mint(3), launchpad: null, market: "pumpfun-amm" }),
      row({ mint: mint(4), launchpad: { name: "Other" }, market: "pumpfun" }),
      row({ mint: mint(5), launchpad: {}, market: "raydium" }),
    ]);
    const result = await fetchTokenRankings({
      ...options,
      platform: "pumpfun",
    });
    expect(result.map((token) => token.mint).sort()).toEqual(
      [mint(1), mint(2), mint(3)].sort(),
    );
    expect(options.fetch.mock.calls[0][0]).toContain("launchpad=pumpfun");
    expect(result[0].warnings?.join(" ")).not.toContain("Bags graduates");
  });

  test("re-sorts promoted rows only by validated hourly metrics, deduplicates and returns five", async () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      row({ mint: mint(index), volume_1h: 100 + index }),
    );
    const options = setup([
      row({ mint: mint(99), volume_1h: null, promoted: true }),
      ...rows,
      row({ mint: mint(5), volume_1h: 1_000 }),
    ]);
    const result = await fetchTokenRankings(options);
    expect(result.map((token) => token.mint)).toEqual([
      mint(5),
      mint(6),
      mint(4),
      mint(3),
      mint(2),
    ]);
    expect(result.map((token) => token.sourceRank)).toEqual([1, 2, 3, 4, 5]);
  });

  test("preserves exact case-sensitive mint strings", async () => {
    const options = setup([row({ mint: KIMCHI })]);
    expect((await fetchTokenRankings(options))[0].mint).toBe(KIMCHI);
  });

  test("keeps missing or invalid optional price changes unknown, not zero", async () => {
    expect(
      (
        await fetchTokenRankings(
          setup([row({ events: { "1h": { priceChangePercentage: "-7" } } })]),
        )
      )[0].priceChange1hPercent,
    ).toBeNull();
    expect(
      (
        await fetchTokenRankings(
          setup([row({ events: { "1h": { priceChangePercentage: 0 } } })]),
        )
      )[0].priceChange1hPercent,
    ).toBe(0);
  });

  test("does not promote unsafe or mislabeled metadata links or key-bearing URLs", async () => {
    const result = await fetchTokenRankings(
      setup([
        row({
          image: `https://assets.example.com/${KEY}.png`,
          socials: {
            website: "https://example.com/?api_key=hidden",
            twitter: "https://evil.com/twitter",
            telegram: "javascript:bad",
          },
        }),
      ]),
    );
    expect(result[0]).toMatchObject({
      imageUrl: null,
      website: null,
      twitter: null,
      telegram: null,
    });
    expect(result[0].sourceUrl).toBe(
      `https://www.solanatracker.io/token/${SYMF}`,
    );
  });

  test.each([
    null,
    [],
    { status: "error", data: [] },
    { status: "success", data: {} },
    { status: "success", data: Array(36).fill(row()) },
  ])("rejects invalid envelopes without leaking raw data: %j", async (body) => {
    const options = setup();
    options.fetch.mockResolvedValue(Response.json(body));
    await expect(fetchTokenRankings(options)).rejects.toThrow(
      "invalid ranking response",
    );
    expect(options.fetch).toHaveBeenCalledOnce();
  });

  test("does not retry HTTP errors, parse errors, or expose provider body/errors", async () => {
    const options = setup();
    for (const response of [
      new Response(`key=${KEY}`, { status: 429 }),
      new Response(`not-json-${KEY}`),
    ]) {
      options.fetch.mockResolvedValueOnce(response);
      await expect(fetchTokenRankings(options)).rejects.toThrow(
        "Solana Tracker request failed; no retry was attempted.",
      );
    }
    options.fetch.mockRejectedValueOnce(new Error(`network ${KEY}`));
    await expect(fetchTokenRankings(options)).rejects.not.toThrow(KEY);
    expect(options.reserveRequest).toHaveBeenCalledTimes(3);
    expect(options.fetch).toHaveBeenCalledTimes(3);
  });

  test("rejects redirects and never reads a redirect error body", async () => {
    const options = setup();
    options.fetch.mockResolvedValueOnce(
      new Response(KEY, {
        status: 302,
        headers: { location: "https://evil.com/" },
      }),
    );
    await expect(fetchTokenRankings(options)).rejects.toThrow("request failed");
    const response = Response.json({ status: "success", data: [row()] });
    Object.defineProperty(response, "redirected", { value: true });
    options.fetch.mockResolvedValueOnce(response);
    await expect(fetchTokenRankings(options)).rejects.toThrow("request failed");
  });

  test("enforces both declared and streamed byte limits", async () => {
    const options = setup();
    options.fetch.mockResolvedValueOnce(
      new Response("{}", { headers: { "content-length": "1048577" } }),
    );
    await expect(fetchTokenRankings(options)).rejects.toThrow("request failed");
    options.fetch.mockResolvedValueOnce(new Response(" ".repeat(1_048_577)));
    await expect(fetchTokenRankings(options)).rejects.toThrow("request failed");
  });

  test("aborts one attempt after the 20-second deadline", async () => {
    vi.useFakeTimers();
    const options = setup();
    options.fetch.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const result = fetchTokenRankings(options);
    const assertion = expect(result).rejects.toThrow("request failed");
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(options.fetch).toHaveBeenCalledOnce();
  });

  test("invalid local configuration never reserves or sends a request", async () => {
    const options = setup();
    await expect(
      fetchTokenRankings({ ...options, apiKey: "bad\nkey" }),
    ).rejects.toThrow("configuration is invalid");
    await expect(fetchTokenRankings({ ...options, now: NaN })).rejects.toThrow(
      "configuration is invalid",
    );
    expect(options.reserveRequest).not.toHaveBeenCalled();
    expect(options.fetch).not.toHaveBeenCalled();
  });
});

describe("optional token metadata enrichment", () => {
  test("uses one reservation and retains numeric search metrics and timestamps", async () => {
    const options = setup();
    const [snapshot] = await fetchTokenRankings(options);
    options.fetch.mockResolvedValueOnce(
      Response.json({
        token: {
          mint: SYMF,
          description: "Project metadata",
          image: "https://example.com/new.png",
          website: "https://new.example.com/",
          twitter: "https://x.com/new",
          telegram: "https://t.me/new",
        },
        pools: [{ price: { usd: 999 } }],
      }),
    );
    const enriched = await enrichTokenSnapshot({ ...options, snapshot });
    expect(enriched).toMatchObject({
      ...snapshot,
      metadataAsOf: NOW,
      description: "Project metadata",
      imageUrl: "https://example.com/new.png",
      website: "https://new.example.com/",
      twitter: "https://x.com/new",
      telegram: "https://t.me/new",
    });
    expect(options.fetch.mock.calls[1][0]).toBe(
      `https://data.solanatracker.io/tokens/${SYMF}`,
    );
    expect(options.reserveRequest).toHaveBeenCalledTimes(2);
  });

  test("budget denial retains snapshot and adds a warning without a request", async () => {
    const options = setup();
    const [snapshot] = await fetchTokenRankings(options);
    options.reserveRequest.mockResolvedValue(false);
    const enriched = await enrichTokenSnapshot({ ...options, snapshot });
    expect(enriched.priceUsd).toBe(snapshot.priceUsd);
    expect(enriched.warnings).toContain(
      "Metadata enrichment skipped: free-tier request budget exhausted.",
    );
    expect(options.fetch).toHaveBeenCalledOnce();
  });

  test("a mismatched or malformed detail is not merged or retried", async () => {
    const options = setup();
    const [snapshot] = await fetchTokenRankings(options);
    options.fetch.mockResolvedValueOnce(
      Response.json({ token: { mint: KIMCHI, description: KEY } }),
    );
    const enriched = await enrichTokenSnapshot({ ...options, snapshot });
    expect(enriched).toEqual({
      ...snapshot,
      warnings: [
        ...(snapshot.warnings ?? []),
        "Metadata enrichment unavailable; validated search metrics retained.",
      ],
    });
    expect(enriched.metadataAsOf).toBeUndefined();
    expect(enriched.warnings?.join(" ")).toContain("unavailable");
    expect(JSON.stringify(enriched)).not.toContain(KEY);
    expect(options.fetch).toHaveBeenCalledTimes(2);
  });

  test("strictSocials never becomes an official website; validated social hosts remain unverified", async () => {
    const options = setup();
    const [snapshot] = await fetchTokenRankings(options);
    options.fetch.mockResolvedValueOnce(
      Response.json({
        token: {
          mint: SYMF,
          description: KEY,
          image: "javascript:bad",
          strictSocials: {
            website: "https://evil.com/",
            twitter: "https://x.com/other",
            telegram: "https://t.me/other",
          },
        },
      }),
    );
    const enriched = await enrichTokenSnapshot({ ...options, snapshot });
    expect(enriched.website).toBe(snapshot.website);
    expect(enriched.imageUrl).toBe(snapshot.imageUrl);
    expect(enriched.description).toBeNull();
    expect(enriched.twitter).toBe("https://x.com/other");
    expect(enriched.telegram).toBe("https://t.me/other");
  });
});
