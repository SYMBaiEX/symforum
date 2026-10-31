import { isSolanaAddress, record } from "./forum-commerce";
import type { MarketBinding } from "./symf-market-overview";
import {
  PublicMarketSourceError,
  marketProviderRetryAt,
} from "./chart-cache-policy";

export const MARKET_QUOTES = [
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
] as const;

/** A display market is not a verified swap mint or an endorsement. */
export function selectMarketBinding(
  value: unknown,
  mint: string,
): MarketBinding {
  if (!isSolanaAddress(mint) || !Array.isArray(value) || value.length > 100)
    throw Error("invalid_market_snapshot");
  const candidates = value
    .map(record)
    .filter(
      (p) =>
        p.chainId === "solana" &&
        record(p.baseToken).address === mint &&
        isSolanaAddress(String(p.pairAddress)) &&
        MARKET_QUOTES.some((quote) => quote === record(p.quoteToken).address),
    );
  const liquidity = (p: Record<string, unknown>) => {
    const amount = record(p.liquidity).usd;
    return typeof amount === "number" && Number.isFinite(amount) && amount > 0
      ? amount
      : 0;
  };
  candidates.sort(
    (a, b) =>
      liquidity(b) - liquidity(a) ||
      String(a.pairAddress).localeCompare(String(b.pairAddress)),
  );
  const pair = candidates[0];
  if (!pair || liquidity(pair) <= 0) throw Error("market_pool_unavailable");
  return {
    mint,
    pool: String(pair.pairAddress),
    quote: String(record(pair.quoteToken).address),
  };
}

export function marketPrice(
  value: unknown,
  expected: MarketBinding,
): number | null {
  if (!Array.isArray(value)) return null;
  const pair = value
    .map(record)
    .find(
      (p) =>
        p.chainId === "solana" &&
        p.pairAddress === expected.pool &&
        record(p.baseToken).address === expected.mint &&
        record(p.quoteToken).address === expected.quote,
    );
  const raw = pair?.priceUsd;
  if (
    typeof raw !== "string" ||
    !/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)
  )
    return null;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** Enforce the byte ceiling while reading, not after buffering a hostile body. */
async function readBoundedPublicMarket(
  url: string,
  limit: number,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["api.dexscreener.com", "api.geckoterminal.com"].includes(parsed.hostname)
  )
    throw new PublicMarketSourceError("unsupported", "invalid_market_provider");
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
    redirect: "error",
  });
  if (!response.ok) {
    const retryAfterAt =
      response.status === 429 || response.status === 503
        ? marketProviderRetryAt(response.headers.get("retry-after"), Date.now())
        : null;
    void response.body?.cancel().catch(() => {});
    throw new PublicMarketSourceError(
      response.status === 429
        ? "http-429"
        : response.status >= 500
          ? "http-5xx"
          : "http-4xx",
      "market_provider_unavailable",
      retryAfterAt,
    );
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    void response.body?.cancel().catch(() => {});
    throw new PublicMarketSourceError(
      "invalid-response",
      "market_response_too_large",
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new PublicMarketSourceError(
      "invalid-response",
      "market_provider_empty",
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new PublicMarketSourceError(
          "invalid-response",
          "market_response_too_large",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new PublicMarketSourceError(
      "invalid-response",
      "invalid_market_response",
    );
  }
}

/** Typed safe diagnostics; never retain provider body, URL or raw exception text. */
export async function readPublicMarket(
  url: string,
  limit: number,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  try {
    return await readBoundedPublicMarket(url, limit, fetcher);
  } catch (error) {
    if (error instanceof PublicMarketSourceError) throw error;
    const timeout =
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name);
    throw new PublicMarketSourceError(
      timeout ? "timeout" : "network",
      "market_provider_unavailable",
    );
  }
}
