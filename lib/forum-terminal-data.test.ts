import { describe, expect, test } from "vitest";
import {
  crossedPrice,
  discoveryBandForSlot,
  parseTerminalMint,
  snapshotToTerminal,
  sumTerminalTokenAccounts,
  validTerminalPrice,
} from "./forum-terminal-data";
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "./forum-commerce";
import { MARKET_CAP_BANDS } from "./forum-market-cap";
import type { TokenSnapshot } from "./token-alpha";

const mint = "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump";
const owner = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
const account = {
  owner: TOKEN_2022_PROGRAM,
  data: {
    parsed: {
      type: "mint",
      info: {
        isInitialized: true,
        decimals: 6,
        mintAuthority: null,
        freezeAuthority: null,
        extensions: [{ extension: "metadataPointer" }],
      },
    },
  },
};

describe("terminal data boundaries", () => {
  test("rotates complete cap coverage using the existing hourly slots", () => {
    const bags = new Set(
      Array.from({ length: 7 }, (_, i) =>
        discoveryBandForSlot(i * 3_600_000, "bags"),
      ),
    );
    expect(bags).toEqual(
      new Set([
        "50k100k",
        "500k1m",
        "under50k",
        "100k500k",
        "1m10m",
        "over10m",
        "all",
      ]),
    );
    expect(discoveryBandForSlot(0, "bags")).not.toBe(
      discoveryBandForSlot(0, "pumpfun"),
    );
    expect(MARKET_CAP_BANDS.find((b) => b.id === "50k100k")?.minimumUsd).toBe(
      50_000,
    );
  });
  test("checked authorities are distinct from missing/invalid evidence", () => {
    expect(parseTerminalMint(account, mint, 123).risk).toMatchObject({
      mint,
      checkedAt: 123,
      mintAuthority: null,
      freezeAuthority: null,
      status: "checked",
      unsupportedExtensions: [],
    });
    expect(() =>
      parseTerminalMint(
        {
          owner: TOKEN_2022_PROGRAM,
          data: {
            parsed: {
              type: "mint",
              info: { isInitialized: true, decimals: 6 },
            },
          },
        },
        mint,
        123,
      ),
    ).toThrow("authority");
    expect(() => parseTerminalMint({ ...account, owner }, mint, 123)).toThrow(
      "mint",
    );
  });
  test("reports unsupported transfer extensions without calling the mint safe", () => {
    const changed = structuredClone(account);
    changed.data.parsed.info.extensions = [{ extension: "transferFeeConfig" }];
    const risk = parseTerminalMint(changed, mint, 123).risk;
    expect(risk.unsupportedExtensions).toEqual(["transferFeeConfig"]);
    expect(risk).not.toHaveProperty("safe");
  });
  test("rejects arbitrary extension text and malformed numeric mint metadata", () => {
    const changed = structuredClone(account);
    changed.data.parsed.info.extensions = [{ extension: "<script>" }];
    expect(() => parseTerminalMint(changed, mint, 123)).toThrow("extension");
    changed.data.parsed.info.decimals = 19;
    expect(() => parseTerminalMint(changed, mint, 123)).toThrow("mint");
  });
  test("wallet balance sums exact integer amounts including frozen holdings", () => {
    const row = (amount: string, state = "initialized") => ({
      pubkey: mint,
      account: {
        owner: TOKEN_PROGRAM,
        data: {
          parsed: {
            type: "account",
            info: { owner, mint, state, tokenAmount: { amount, decimals: 6 } },
          },
        },
      },
    });
    expect(
      sumTerminalTokenAccounts(
        { value: [row("123"), row("7", "frozen")] },
        owner,
        mint,
        6,
        TOKEN_PROGRAM,
      ),
    ).toBe("130");
    expect(() =>
      sumTerminalTokenAccounts(
        { value: [row("2")] },
        mint,
        mint,
        6,
        TOKEN_PROGRAM,
      ),
    ).toThrow();
    expect(() =>
      sumTerminalTokenAccounts(
        { value: [row("1.1")] },
        owner,
        mint,
        6,
        TOKEN_PROGRAM,
      ),
    ).toThrow();
    expect(() =>
      sumTerminalTokenAccounts(
        { value: [row("2")] },
        owner,
        mint,
        9,
        TOKEN_PROGRAM,
      ),
    ).toThrow();
  });
  test("price alerts require a real crossing, not an initial observation or repeated same snapshot", () => {
    expect(crossedPrice(null, 15, 10, "above")).toBe(false);
    expect(crossedPrice(9, 10, 10, "above")).toBe(true);
    expect(crossedPrice(10, 11, 10, "above")).toBe(false);
    expect(crossedPrice(11, 10, 10, "below")).toBe(true);
    expect(crossedPrice(9, 8, 10, "below")).toBe(false);
    expect(validTerminalPrice(Number.NaN)).toBe(false);
    expect(validTerminalPrice(0)).toBe(false);
    expect(validTerminalPrice(null)).toBe(true);
  });
  test("public terminal projections do not promote market cap into FDV or private analysis", () => {
    const snapshot = {
      platform: "pumpfun",
      mint,
      name: "Example",
      symbol: "EX",
      observedAt: 123,
      metricsAsOf: 120,
      priceUsd: 1,
      marketCapUsd: 75_000,
      holders: 12,
      volume1hUsd: 10,
      liquidityUsd: 100,
      priceChange1hPercent: 2,
      imageUrl: null,
      website: null,
      twitter: null,
      telegram: null,
      description: null,
      sourceUrl: `https://www.solanatracker.io/token/${mint}`,
      sourceRank: 1,
      analysis: "private",
    } as TokenSnapshot;
    const view = snapshotToTerminal(snapshot);
    expect(view.marketCapUsd).toBe(75_000);
    expect(view.fdvUsd).toBeNull();
    expect(view.threadId).toBeNull();
    expect(view).not.toHaveProperty("analysis");
  });
});
