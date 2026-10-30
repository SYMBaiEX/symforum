import {
  isSolanaAddress,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  unsignedRaw,
  record,
} from "./forum-commerce";
import { DISCOVERY_CAP_ROTATION, type MarketCapBand } from "./forum-market-cap";
import type { TerminalMarket } from "./forum-terminal-model";
import type { TokenSnapshot } from "./token-alpha";

export const TERMINAL_FRESH_MS = 15 * 60_000;
export const TERMINAL_RETENTION_MS = 24 * 60 * 60_000;
export const TERMINAL_WALLET_TTL_MS = 60_000;
export const TERMINAL_RISK_TTL_MS = 10 * 60_000;
export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

/** Same hourly fetch and allowance; different market-cap segment each slot. */
export function discoveryBandForSlot(
  now: number,
  platform: "bags" | "pumpfun",
): MarketCapBand {
  const slot = Math.floor(now / 3_600_000) + (platform === "bags" ? 0 : 3);
  return DISCOVERY_CAP_ROTATION[slot % DISCOVERY_CAP_ROTATION.length];
}

export function snapshotToTerminal(snapshot: TokenSnapshot): TerminalMarket {
  return {
    mint: snapshot.mint,
    name: snapshot.name,
    symbol: snapshot.symbol,
    platform: snapshot.platform,
    observedAt: snapshot.observedAt,
    metricsAsOf: snapshot.metricsAsOf,
    priceUsd: snapshot.priceUsd,
    marketCapUsd: snapshot.marketCapUsd,
    fdvUsd: null,
    liquidityUsd: snapshot.liquidityUsd,
    volume1hUsd: snapshot.volume1hUsd,
    volume24hUsd: null,
    holders: snapshot.holders,
    priceChange1hPercent: snapshot.priceChange1hPercent,
    imageUrl: snapshot.imageUrl,
    website: snapshot.website,
    twitter: snapshot.twitter,
    telegram: snapshot.telegram,
    description: snapshot.description,
    sourceUrl: snapshot.sourceUrl,
    sourceRank: snapshot.sourceRank,
    threadId: null,
    threadUrl: null,
  };
}

export type TerminalRisk = {
  mint: string;
  checkedAt: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  tokenProgram: string;
  unsupportedExtensions: string[];
  status: "checked";
};

/** Authority absence is a checked fact, never a token safety verdict. */
export function parseTerminalMint(
  value: unknown,
  mint: string,
  checkedAt: number,
) {
  if (!isSolanaAddress(mint)) throw new Error("Invalid mint.");
  const account = record(value),
    parsed = record(record(account.data).parsed),
    info = record(parsed.info);
  if (
    ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(String(account.owner)) ||
    parsed.type !== "mint" ||
    info.isInitialized !== true ||
    !Number.isSafeInteger(info.decimals) ||
    Number(info.decimals) < 0 ||
    Number(info.decimals) > 18
  )
    throw new Error("Unverified mint.");
  const authority = (value: unknown) => {
    if (value === null) return null;
    if (typeof value !== "string" || !isSolanaAddress(value))
      throw new Error("Unverified authority.");
    return value;
  };
  const extensions = info.extensions ?? [];
  if (!Array.isArray(extensions) || extensions.length > 32)
    throw new Error("Unverified extensions.");
  const names = extensions.map((entry) => {
    const extension = record(entry).extension;
    if (
      typeof extension !== "string" ||
      !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(extension)
    )
      throw new Error("Unverified extension.");
    return extension;
  });
  return {
    decimals: Number(info.decimals),
    risk: {
      mint,
      checkedAt,
      mintAuthority: authority(info.mintAuthority),
      freezeAuthority: authority(info.freezeAuthority),
      tokenProgram: String(account.owner),
      unsupportedExtensions: names.filter(
        (name) =>
          !["metadataPointer", "tokenMetadata", "immutableOwner"].includes(
            name,
          ),
      ),
      status: "checked" as const,
    },
  };
}

/** A response for another owner/mint/program must never become a balance. */
export function sumTerminalTokenAccounts(
  value: unknown,
  wallet: string,
  mint: string,
  decimals: number,
  tokenProgram: string,
) {
  const result = record(value);
  if (!Array.isArray(result.value) || result.value.length > 100)
    throw new Error("Unverified accounts.");
  let sum = 0n;
  for (const row of result.value) {
    const entry = record(row),
      account = record(entry.account),
      parsed = record(record(account.data).parsed),
      info = record(parsed.info),
      token = record(info.tokenAmount);
    if (
      !isSolanaAddress(String(entry.pubkey)) ||
      account.owner !== tokenProgram ||
      parsed.type !== "account" ||
      info.owner !== wallet ||
      info.mint !== mint ||
      token.decimals !== decimals ||
      !["initialized", "frozen"].includes(String(info.state)) ||
      typeof token.amount !== "string"
    )
      throw new Error("Unverified account.");
    // Display includes frozen holdings, but a swap always rechecks spendability.
    sum += unsignedRaw(token.amount);
  }
  unsignedRaw(String(sum));
  return String(sum);
}

export function validTerminalPrice(value: number | null | undefined) {
  return (
    value === null ||
    value === undefined ||
    (Number.isFinite(value) && value > 0 && value <= 1e15)
  );
}

export function crossedPrice(
  previous: number | null,
  current: number,
  threshold: number,
  direction: "above" | "below",
) {
  if (previous === null) return false; // first observation establishes the baseline
  return direction === "above"
    ? previous < threshold && current >= threshold
    : previous > threshold && current <= threshold;
}
