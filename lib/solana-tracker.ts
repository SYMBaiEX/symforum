import type { TokenPlatform, TokenSnapshot } from "./token-alpha";

const API_ORIGIN = "https://data.solanatracker.io";
const MAX_RESPONSE_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_METRIC_AGE_MS = 15 * 60_000;
const MAX_FUTURE_SKEW_MS = 60_000;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PROGRAM_ADDRESSES = new Set([
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ComputeBudget111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "BPFLoaderUpgradeab1e11111111111111111111111",
  "BPFLoader2111111111111111111111111111111111",
]);
const UNSAFE_URL =
  /[\s\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff\[\]<>"'\\]/u;
const UNSAFE_IDENTITY_CONTROLS =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export const TOKEN_INDEX_COVERAGE_WARNING =
  "Limited-coverage pilot: eligible tokens in Solana Tracker's index, not the platform-wide top five.";

export type TokenDataErrorCode =
  | "configuration"
  | "budget-denied"
  | "invalid-request"
  | "network"
  | "timeout"
  | "http-400"
  | "http-401"
  | "http-402"
  | "http-403"
  | "http-429"
  | "http-4xx"
  | "http-5xx"
  | "redirect"
  | "oversized-response"
  | "missing-response"
  | "invalid-json"
  | "invalid-response";

export class SolanaTrackerError extends Error {
  constructor(readonly code: TokenDataErrorCode) {
    super("Solana Tracker data request failed.");
    this.name = "SolanaTrackerError";
  }
}

/** Shared closed classifiers; no provider text is retained. */
export function tokenDataHttpFailure(status: number): TokenDataErrorCode {
  if (status >= 300 && status < 400) return "redirect";
  if (status === 400) return "http-400";
  if (status === 401) return "http-401";
  if (status === 402) return "http-402";
  if (status === 403) return "http-403";
  if (status === 429) return "http-429";
  return status >= 500 && status < 600 ? "http-5xx" : "http-4xx";
}

export function tokenDataFailureIsRetryable(code: TokenDataErrorCode): boolean {
  return ["network", "timeout", "http-429", "http-5xx"].includes(code);
}

/** Null means the server's hint cannot safely fit the two-second retry bound. */
export function tokenDataRetryDelay(
  header: string | null,
  now = Date.now(),
): number | null {
  if (header === null) return 250;
  const value = header.trim();
  let delay: number;
  if (/^\d+(?:\.\d+)?$/.test(value)) delay = Math.ceil(Number(value) * 1_000);
  else {
    // HTTP-date forms begin with a weekday. Do not let Date.parse interpret
    // malformed delta-seconds such as "-1" as a date in a previous year.
    if (!/^[A-Za-z]{3,9}[,\s]/.test(value)) return null;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    delay = Math.max(0, timestamp - now);
  }
  return Number.isFinite(delay) && delay >= 0 && delay <= 2_000 ? delay : null;
}

class AttemptFailure extends Error {
  constructor(
    readonly code: TokenDataErrorCode,
    readonly retryDelay: number | null = 250,
  ) {
    super("Solana Tracker transport attempt failed.");
  }
}

type RequestOptions = {
  apiKey: string;
  now: number;
  /** Must reserve a request durably, including requests that subsequently fail. */
  reserveRequest: () => Promise<boolean>;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maxLength = 2_048): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= maxLength ? result : null;
}

function identityText(value: unknown, maxLength: number): string | null {
  // This rejects unsafe identity metadata, not the on-chain mint itself.
  // Never strip directional/control characters into a different public name.
  // ZWJ and variation selectors remain allowed for ordinary composed emoji.
  if (typeof value !== "string" || UNSAFE_IDENTITY_CONTROLS.test(value))
    return null;
  return text(value, maxLength);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

/** Validate decoded length, not just the base58 alphabet or suffix. */
function eligibleMint(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 44 ||
    PROGRAM_ADDRESSES.has(value)
  )
    return false;
  let decoded = BigInt(0);
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * BigInt(58) + BigInt(digit);
  }
  let bytes = 0;
  while (decoded > BigInt(0)) {
    decoded >>= BigInt(8);
    bytes++;
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes++;
  }
  return bytes === 32;
}

function safeUrl(value: unknown, apiKey: string): string | null {
  const candidate = text(value);
  if (
    !candidate ||
    candidate.includes(apiKey) ||
    UNSAFE_URL.test(candidate) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f|5b|5d|3c|3e|22|27)/i.test(candidate)
  )
    return null;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !url.hostname.includes(".") ||
      /^[\d.]+$/.test(url.hostname) ||
      url.hostname.startsWith("[") ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname)
    )
      return null;
    for (const key of url.searchParams.keys()) {
      if (/key|token|secret|password|authorization|credential/i.test(key))
        return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function socialUrl(
  value: unknown,
  kind: "twitter" | "telegram",
  apiKey: string,
): string | null {
  const result = safeUrl(value, apiKey);
  if (!result) return null;
  const url = new URL(result);
  const hostname = url.hostname.toLowerCase();
  const hosts =
    kind === "twitter"
      ? ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]
      : ["t.me", "www.t.me", "telegram.me", "www.telegram.me"];
  if (!hosts.includes(hostname)) return null;
  try {
    // A platform homepage (even with query/fragment or encoded empty path)
    // identifies no project profile, channel, community or post.
    return decodeURIComponent(url.pathname).replace(/\//g, "").trim()
      ? result
      : null;
  } catch {
    return null;
  }
}

function sourcePlatform(
  row: Record<string, unknown>,
  platform: TokenPlatform,
  apiKey: string,
): boolean {
  const launchpad = object(row.launchpad);
  const name = text(launchpad?.name)?.toLowerCase();
  const url = safeUrl(launchpad?.url, apiKey);
  const host = url ? new URL(url).hostname.toLowerCase() : null;
  if (platform === "bags") {
    return name === "bags" || host === "bags.fm" || host === "www.bags.fm";
  }
  const explicitPump =
    name === "pumpfun" ||
    name === "pump.fun" ||
    host === "pump.fun" ||
    host === "www.pump.fun";
  if (explicitPump) return true;
  // Search is origin-filtered. Only an unlabelled native Pump market can
  // supplement the missing label; never override a conflicting launchpad.
  return (
    !name && !url && (row.market === "pumpfun" || row.market === "pumpfun-amm")
  );
}

function validateRequest(options: RequestOptions): void {
  if (
    !options.apiKey ||
    options.apiKey !== options.apiKey.trim() ||
    /[\s\u0000-\u001f\u007f]/u.test(options.apiKey) ||
    !Number.isSafeInteger(options.now) ||
    options.now <= 0
  )
    throw new SolanaTrackerError("configuration");
}

/** Exactly one transport attempt; the ranking wrapper owns bounded retries. */
async function requestJson(
  path: string,
  options: RequestOptions,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ORIGIN}${path}`, {
      headers: { "x-api-key": options.apiKey, accept: "application/json" },
      // Manual mode follows no redirect and lets us reject 3xx without
      // confusing fetch's opaque redirect TypeError with a retryable network error.
      redirect: "manual",
      signal: controller.signal,
    });
    if (
      response.redirected ||
      (response.url && new URL(response.url).origin !== API_ORIGIN)
    ) {
      throw new AttemptFailure("redirect");
    }
    if (!response.ok)
      throw new AttemptFailure(
        tokenDataHttpFailure(response.status),
        tokenDataRetryDelay(response.headers.get("retry-after")),
      );
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_RESPONSE_BYTES)
      throw new AttemptFailure("oversized-response");
    if (!response.body) throw new AttemptFailure("missing-response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES)
          throw new AttemptFailure("oversized-response");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const joined = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) {
      joined.set(chunk, position);
      position += chunk.byteLength;
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(joined),
      ) as unknown;
    } catch {
      throw new AttemptFailure("invalid-json");
    }
  } catch (error) {
    if (error instanceof AttemptFailure) throw error;
    throw new AttemptFailure(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function reserve(options: RequestOptions): Promise<boolean> {
  try {
    return await options.reserveRequest();
  } catch {
    throw new SolanaTrackerError("budget-denied");
  }
}

async function requestRanking(
  path: string,
  options: RequestOptions,
): Promise<unknown | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await reserve(options))) {
      if (attempt === 0) return undefined;
      throw new SolanaTrackerError("budget-denied");
    }
    try {
      return await requestJson(path, options);
    } catch (error) {
      const failure =
        error instanceof AttemptFailure ? error : new AttemptFailure("network");
      if (
        attempt === 0 &&
        tokenDataFailureIsRetryable(failure.code) &&
        failure.retryDelay !== null
      ) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, failure.retryDelay!),
        );
        continue;
      }
      throw new SolanaTrackerError(failure.code);
    }
  }
  throw new SolanaTrackerError("network");
}

function rankedSnapshot(
  value: unknown,
  options: RequestOptions & { platform: TokenPlatform },
): TokenSnapshot | null {
  const row = object(value);
  if (!row || !eligibleMint(row.mint)) return null;
  const name = identityText(row.name, 200);
  const symbol = identityText(row.symbol, 80);
  const visible = (value: string | null) =>
    value?.replace(
      /[\s\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu,
      "",
    );
  if (
    !name ||
    !symbol ||
    !visible(name) ||
    !visible(symbol) ||
    name.includes(options.apiKey) ||
    symbol.includes(options.apiKey) ||
    !positive(row.priceUsd) ||
    !positive(row.marketCapUsd) ||
    !positive(row.liquidityUsd) ||
    !positive(row.volume_1h) ||
    !positive(row.holders) ||
    !Number.isSafeInteger(row.holders) ||
    !finite(row.decimals) ||
    !Number.isSafeInteger(row.decimals) ||
    row.decimals < 0 ||
    row.decimals > 255 ||
    !finite(row.lastUpdated) ||
    !Number.isSafeInteger(row.lastUpdated) ||
    options.now - row.lastUpdated > MAX_METRIC_AGE_MS ||
    row.lastUpdated - options.now > MAX_FUTURE_SKEW_MS ||
    !sourcePlatform(row, options.platform, options.apiKey)
  )
    return null;
  const socials = object(row.socials);
  const events = object(row.events);
  const hour = object(events?.["1h"]);
  const priceChange = hour?.priceChangePercentage;
  const warnings = [TOKEN_INDEX_COVERAGE_WARNING];
  if (options.platform === "bags")
    warnings.push("Original Bags graduates may be missing from this index.");
  return {
    platform: options.platform,
    mint: row.mint,
    name,
    symbol,
    observedAt: options.now,
    metricsAsOf: row.lastUpdated,
    priceUsd: row.priceUsd,
    marketCapUsd: row.marketCapUsd,
    holders: row.holders,
    volume1hUsd: row.volume_1h,
    liquidityUsd: row.liquidityUsd,
    priceChange1hPercent: finite(priceChange) ? priceChange : null,
    imageUrl: safeUrl(row.image, options.apiKey),
    website: safeUrl(socials?.website, options.apiKey),
    twitter: socialUrl(socials?.twitter, "twitter", options.apiKey),
    telegram: socialUrl(socials?.telegram, "telegram", options.apiKey),
    description: null,
    sourceUrl: `https://www.solanatracker.io/token/${row.mint}`,
    sourceRank: 1,
    warnings,
  };
}

/** Eligible indexed candidates, not a claim of platform-wide ranking coverage. */
export async function fetchTokenRankings(
  options: RequestOptions & { platform: TokenPlatform },
): Promise<TokenSnapshot[]> {
  validateRequest(options);
  if (options.platform !== "bags" && options.platform !== "pumpfun") {
    throw new SolanaTrackerError("invalid-request");
  }
  const params = new URLSearchParams({
    launchpad: options.platform,
    sortBy: "volume_1h",
    sortOrder: "desc",
    limit: "30",
    showPriceChanges: "true",
  });
  const response = await requestRanking(`/search?${params}`, options);
  if (response === undefined) return [];
  const result = object(response);
  if (
    !result ||
    result.status !== "success" ||
    !Array.isArray(result.data) ||
    result.data.length > 35
  ) {
    throw new SolanaTrackerError("invalid-response");
  }
  const seen = new Set<string>();
  return result.data
    .map((row) => rankedSnapshot(row, options))
    .filter((row): row is TokenSnapshot => row !== null)
    .sort(
      (a, b) => b.volume1hUsd! - a.volume1hUsd! || a.mint.localeCompare(b.mint),
    )
    .filter((row) => {
      if (seen.has(row.mint)) return false;
      seen.add(row.mint);
      return true;
    })
    .slice(0, 5)
    .map((row, index) => ({ ...row, sourceRank: index + 1 }));
}

function withWarning(snapshot: TokenSnapshot, warning: string): TokenSnapshot {
  return {
    ...snapshot,
    warnings: [...new Set([...(snapshot.warnings ?? []), warning])],
  };
}

/** One optional metadata request. Never replace search metrics with pool metrics. */
export async function enrichTokenSnapshot(
  options: RequestOptions & { snapshot: TokenSnapshot },
): Promise<TokenSnapshot> {
  validateRequest(options);
  const { snapshot } = options;
  if (!eligibleMint(snapshot.mint))
    return withWarning(snapshot, "Metadata unavailable: invalid mint.");
  if (!(await reserve(options)))
    return withWarning(
      snapshot,
      "Metadata enrichment skipped: free-tier request budget exhausted.",
    );
  try {
    const response = object(
      await requestJson(`/tokens/${snapshot.mint}`, options),
    );
    const token = object(response?.token);
    if (!token || token.mint !== snapshot.mint)
      throw new Error("mismatched-token");
    const socials = object(token.socials);
    const strictSocials = object(token.strictSocials);
    const rawDescription = text(token.description, 10_000);
    const description =
      rawDescription && !rawDescription.includes(options.apiKey)
        ? rawDescription.slice(0, 2_000)
        : null;
    return {
      ...snapshot,
      metadataAsOf: options.now,
      description: description ?? snapshot.description,
      imageUrl: safeUrl(token.image, options.apiKey) ?? snapshot.imageUrl,
      // strictSocials is not ownership verification and is never an official-site source.
      website:
        safeUrl(token.website, options.apiKey) ??
        safeUrl(socials?.website, options.apiKey) ??
        snapshot.website,
      twitter:
        socialUrl(token.twitter, "twitter", options.apiKey) ??
        socialUrl(socials?.twitter, "twitter", options.apiKey) ??
        socialUrl(strictSocials?.twitter, "twitter", options.apiKey) ??
        snapshot.twitter,
      telegram:
        socialUrl(token.telegram, "telegram", options.apiKey) ??
        socialUrl(socials?.telegram, "telegram", options.apiKey) ??
        socialUrl(strictSocials?.telegram, "telegram", options.apiKey) ??
        snapshot.telegram,
    };
  } catch {
    return withWarning(
      snapshot,
      "Metadata enrichment unavailable; validated search metrics retained.",
    );
  }
}
