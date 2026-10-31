import {
  CHART_CACHE_FRESH_MS,
  CHART_CACHE_RETENTION_MS,
} from "@/lib/chart-cache-policy";
import type { ChartMarketData } from "./price-chart-data";

/** Only the latest callback is considered: authoritative nulls are never filled. */
export function tokenChartReading(
  snapshot: ChartMarketData | null,
  mint: string,
  now: number,
  indexAbsent: boolean,
) {
  if (
    !snapshot ||
    snapshot.mint !== mint ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(snapshot.checkedAt) ||
    snapshot.checkedAt <= 0 ||
    snapshot.checkedAt > now
  )
    return null;
  const age = now - snapshot.checkedAt;
  const stale = snapshot.stale || age >= CHART_CACHE_FRESH_MS;
  if (age >= CHART_CACHE_RETENTION_MS || (stale && !indexAbsent)) return null;
  return { data: snapshot, stale };
}
