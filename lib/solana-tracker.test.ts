import { afterEach, describe, expect, test, vi } from "vitest";
import {
  enrichTokenSnapshot,
  fetchTokenRankings,
  SolanaTrackerError,
} from "./solana-tracker";

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
        redirect: "manual",
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

  test.each([
    { name: "\u202ehctilG yenoM etinifnI" },
    { name: "Infinite \u202eMoney" },
    { symbol: "\u202eHCTILG" },
    { name: "Token\u2067RTL\u2069" },
    { symbol: "T\u2066KN\u2069" },
    { name: "\tToken" },
    { name: "Token\nName" },
    { symbol: "T\u0000KN" },
    { name: "Token\u0085Name" },
    { symbol: "T\u009fKN" },
    { name: "\u061cToken" },
    { name: "Token\u200eName" },
    { symbol: "T\u200fKN" },
    { name: "Token\u202aName" },
    { symbol: "T\u202bKN" },
    { name: "Token\u202cName" },
    { symbol: "T\u202dKN" },
    { name: "Token\u2068Name" },
  ])(
    "rejects unsafe identity metadata without rewriting a valid mint: %#",
    async (identity) => {
      const unsafeMint = "EBku5v4TnkDTDwidxQzaBMRzkGNqoLhCwSaYjDBeMvCo";
      const options = setup([
        row({ mint: unsafeMint, volume_1h: 99_999, ...identity }),
        row({ mint: SYMF }),
      ]);
      const candidates = await fetchTokenRankings(options);
      expect(candidates.map((candidate) => candidate.mint)).toEqual([SYMF]);
      expect(candidates[0].sourceRank).toBe(1);
      expect(options.fetch).toHaveBeenCalledOnce();
      expect(options.reserveRequest).toHaveBeenCalledOnce();
    },
  );

  test.each([
    { name: "👩‍💻 Builders", symbol: "DEV" },
    { name: "Family 👨‍👩‍👧‍👦", symbol: "FAM" },
    { name: "قمر عربي", symbol: "قمر" },
    { name: "月亮 币", symbol: "月" },
    { name: "Ordinary Token Name", symbol: "TOKEN" },
  ])(
    "preserves legible Unicode, composed emoji and ordinary spaces: %#",
    async (identity) => {
      const [candidate] = await fetchTokenRankings(setup([row(identity)]));
      expect(candidate.name).toBe(identity.name);
      expect(candidate.symbol).toBe(identity.symbol);
    },
  );

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
    ["https://t.me/", "https://x.com/"],
    ["https://telegram.me", "https://twitter.com"],
    ["https://www.t.me/?lang=en", "https://www.x.com/#home"],
    ["https://www.telegram.me////", "https://www.twitter.com/?lang=en"],
    ["https://t.me/%2F", "https://x.com/%20"],
  ])(
    "maps bare social platform roots to unknown: Telegram=%s X=%s",
    async (telegram, twitter) => {
      const [candidate] = await fetchTokenRankings(
        setup([row({ socials: { telegram, twitter } })]),
      );
      expect(candidate.telegram).toBeNull();
      expect(candidate.twitter).toBeNull();
    },
  );

  test.each([
    ["https://t.me/project_channel", "https://x.com/project"],
    [
      "https://t.me/+ProjectInvite",
      "https://twitter.com/project/status/123456",
    ],
    ["https://telegram.me/s/project", "https://x.com/i/communities/123456"],
  ])(
    "retains real channel, profile, invite and post links: Telegram=%s X=%s",
    async (telegram, twitter) => {
      const [candidate] = await fetchTokenRankings(
        setup([row({ socials: { telegram, twitter } })]),
      );
      expect(candidate.telegram).toBe(telegram);
      expect(candidate.twitter).toBe(twitter);
    },
  );

  test.each([
    null,
    [],
    { status: "error", data: [] },
    { status: "success", data: {} },
    { status: "success", data: Array(36).fill(row()) },
  ])("rejects invalid envelopes without leaking raw data: %j", async (body) => {
    const options = setup();
    options.fetch.mockResolvedValue(Response.json(body));
    await expect(fetchTokenRankings(options)).rejects.toMatchObject({
      code: "invalid-response",
    });
    expect(options.fetch).toHaveBeenCalledOnce();
  });

  test.each([400, 401, 402, 403, 404, 302])(
    "does not retry permanent HTTP %s failures or expose bodies",
    async (status) => {
      const options = setup();
      options.fetch.mockResolvedValueOnce(new Response(KEY, { status }));
      await expect(fetchTokenRankings(options)).rejects.toBeInstanceOf(
        SolanaTrackerError,
      );
      expect(options.reserveRequest).toHaveBeenCalledOnce();
      expect(options.fetch).toHaveBeenCalledOnce();
    },
  );

  test("malformed JSON is classified and never retried", async () => {
    const options = setup();
    options.fetch.mockResolvedValueOnce(new Response(KEY));
    await expect(fetchTokenRankings(options)).rejects.toMatchObject({
      code: "invalid-json",
      message: "Solana Tracker data request failed.",
    });
    expect(options.fetch).toHaveBeenCalledOnce();
  });

  test.each([429, 500, 503])(
    "reserves a second request before one retry of HTTP %s, with identical credentials",
    async (status) => {
      const options = setup();
      options.fetch.mockResolvedValueOnce(
        new Response(KEY, { status, headers: { "retry-after": "0" } }),
      );
      expect(await fetchTokenRankings(options)).toHaveLength(1);
      expect(options.reserveRequest).toHaveBeenCalledTimes(2);
      expect(options.fetch).toHaveBeenCalledTimes(2);
      expect(options.fetch.mock.calls[1][0]).toBe(
        options.fetch.mock.calls[0][0],
      );
      expect(options.fetch.mock.calls[1][1]!.headers).toEqual(
        options.fetch.mock.calls[0][1]!.headers,
      );
      expect(options.reserveRequest.mock.invocationCallOrder[1]).toBeLessThan(
        options.fetch.mock.invocationCallOrder[1],
      );
    },
  );

  test("network failure receives at most one funded retry and exposes no raw error", async () => {
    const options = setup();
    options.fetch.mockRejectedValue(new Error(KEY));
    await expect(fetchTokenRankings(options)).rejects.toMatchObject({
      code: "network",
      message: "Solana Tracker data request failed.",
    });
    expect(options.reserveRequest).toHaveBeenCalledTimes(2);
    expect(options.fetch).toHaveBeenCalledTimes(2);
  });

  test("repeated transient HTTP failures stop after the second funded attempt", async () => {
    const options = setup();
    options.fetch.mockResolvedValue(
      new Response(KEY, { status: 503, headers: { "retry-after": "0" } }),
    );
    const result = fetchTokenRankings(options);
    await expect(result).rejects.toMatchObject({
      code: "http-5xx",
      message: "Solana Tracker data request failed.",
    });
    const error = await result.catch((value: unknown) => value);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(String(error)).not.toContain(KEY);
    expect(options.fetch).toHaveBeenCalledTimes(2);
    expect(options.reserveRequest).toHaveBeenCalledTimes(2);
  });

  test("retry budget denial never sends an unreserved request or refunds the original", async () => {
    const options = setup();
    options.reserveRequest
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    options.fetch.mockResolvedValueOnce(
      new Response(KEY, { status: 503, headers: { "retry-after": "0" } }),
    );
    await expect(fetchTokenRankings(options)).rejects.toMatchObject({
      code: "budget-denied",
    });
    expect(options.reserveRequest).toHaveBeenCalledTimes(2);
    expect(options.fetch).toHaveBeenCalledOnce();
  });

  test("honors a two-second Retry-After before reserving and sending another request", async () => {
    vi.useFakeTimers();
    const options = setup();
    options.fetch.mockResolvedValueOnce(
      new Response(KEY, { status: 429, headers: { "retry-after": "2" } }),
    );
    const result = fetchTokenRankings(options);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(options.fetch).toHaveBeenCalledOnce();
    expect(options.reserveRequest).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toHaveLength(1);
    expect(options.fetch).toHaveBeenCalledTimes(2);
  });

  test.each(["3", "-1", "bad-hint", new Date(NOW + 3_000).toUTCString()])(
    "does not retry when Retry-After cannot fit the bound: %s",
    async (hint) => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const options = setup();
      options.fetch.mockResolvedValueOnce(
        new Response(KEY, { status: 429, headers: { "retry-after": hint } }),
      );
      await expect(fetchTokenRankings(options)).rejects.toMatchObject({
        code: "http-429",
      });
      expect(options.fetch).toHaveBeenCalledOnce();
      expect(options.reserveRequest).toHaveBeenCalledOnce();
    },
  );

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

  test("aborts each attempt after twenty seconds and performs at most one funded timeout retry", async () => {
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
    const assertion = expect(result).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(40_250);
    await assertion;
    expect(options.fetch).toHaveBeenCalledTimes(2);
    expect(options.reserveRequest).toHaveBeenCalledTimes(2);
  });

  test("invalid local configuration never reserves or sends a request", async () => {
    const options = setup();
    await expect(
      fetchTokenRankings({ ...options, apiKey: "bad\nkey" }),
    ).rejects.toMatchObject({ code: "configuration" });
    await expect(
      fetchTokenRankings({ ...options, now: NaN }),
    ).rejects.toMatchObject({ code: "configuration" });
    expect(options.reserveRequest).not.toHaveBeenCalled();
    expect(options.fetch).not.toHaveBeenCalled();
  });
});

describe("optional token metadata enrichment", () => {
  test("metadata enrichment cannot replace unknown socials with bare platform homepages", async () => {
    const options = setup([row({ socials: {} })]);
    const [snapshot] = await fetchTokenRankings(options);
    options.fetch.mockResolvedValueOnce(
      Response.json({
        token: {
          mint: SYMF,
          twitter: "https://x.com/",
          telegram: "https://t.me/",
          socials: {
            twitter: "https://twitter.com/",
            telegram: "https://telegram.me/",
          },
          strictSocials: {
            twitter: "https://www.x.com/",
            telegram: "https://www.t.me/",
          },
        },
      }),
    );
    const enriched = await enrichTokenSnapshot({ ...options, snapshot });
    expect(enriched.twitter).toBeNull();
    expect(enriched.telegram).toBeNull();
  });
  test("optional metadata remains single-attempt even on a transient failure", async () => {
    const options = setup();
    const [snapshot] = await fetchTokenRankings(options);
    options.fetch.mockResolvedValueOnce(new Response(KEY, { status: 503 }));
    const enriched = await enrichTokenSnapshot({ ...options, snapshot });
    expect(enriched.warnings?.join(" ")).toContain(
      "Metadata enrichment unavailable",
    );
    expect(options.fetch).toHaveBeenCalledTimes(2);
    expect(options.reserveRequest).toHaveBeenCalledTimes(2);
  });
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
