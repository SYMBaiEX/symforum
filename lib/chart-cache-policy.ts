export const CHART_CACHE_FRESH_MS = 5 * 60_000;
export const CHART_CACHE_RETENTION_MS = 24 * 60 * 60_000;
export const CHART_CACHE_LEASE_MS = 25_000;
export const CHART_CACHE_MIN_BACKOFF_MS = 60_000;
export const CHART_CACHE_MAX_BACKOFF_MS = 15 * 60_000;

export type MarketCacheState = "ready" | "loading" | "deferred" | "unavailable" | "budget" | "unsupported";
export type MarketFailureStage = "admission" | "pool" | "candles" | "trades" | "cache";
export type MarketFailureCode = "burst" | "budget" | "incomplete" | "http-429" | "http-4xx" | "http-5xx" | "timeout" | "network" | "invalid-response" | "pool-unavailable" | "unsupported";
export type MarketCacheStatus = {
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  failureCount: number;
  failureStage: MarketFailureStage | null;
  failureCode: MarketFailureCode | null;
};
export type MarketCacheView = {
  state: MarketCacheState;
  payload: string | null;
  stale: boolean;
  cache: MarketCacheStatus;
};

export class PublicMarketSourceError extends Error {
  constructor(
    readonly code: MarketFailureCode,
    message: string,
    readonly retryAfterAt: number | null = null,
  ) {
    super(message);
    this.name = "PublicMarketSourceError";
  }
}

export function marketFailureBackoff(failureCount: number) {
  return Math.min(CHART_CACHE_MAX_BACKOFF_MS,
    CHART_CACHE_MIN_BACKOFF_MS * 2 ** Math.min(20, Math.max(0, Math.floor(failureCount) - 1)));
}

/** Provider hints are dates only, never retained header text or response bodies. */
export function marketProviderRetryAt(header: string | null, now: number): number | null {
  if (!header || !Number.isSafeInteger(now) || now <= 0) return null;
  const raw = header.trim();
  const date = /^\d+(?:\.\d+)?$/.test(raw)
    ? now + Math.ceil(Number(raw) * 1000)
    : /^[A-Za-z]{3,9}[,\s]/.test(raw) ? Date.parse(raw) : NaN;
  return Number.isFinite(date) && date > now
    ? Math.min(date, now + CHART_CACHE_RETENTION_MS)
    : null;
}

export function nextMarketBudgetReset(now: number) {
  return (Math.floor(now / 86_400_000) + 1) * 86_400_000;
}
