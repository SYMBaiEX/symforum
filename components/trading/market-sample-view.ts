import type { TerminalMarket } from "@/lib/forum-terminal-model";
import { marketSources } from "./market-explorer-model";

/** Pool-market freshness only: a holder sample never decides this filter. */
export function marketSampleView(
  rows: readonly TerminalMarket[],
  now: number,
  freshOnly: boolean,
) {
  let fresh = 0,
    stale = 0,
    unknown = 0;
  const included = rows.filter((row) => {
    const source = marketSources(row, now);
    if (source.unavailable || source.market.dateTime === null) {
      unknown++;
      return !freshOnly;
    }
    if (source.market.stale) {
      stale++;
      return !freshOnly;
    }
    fresh++;
    return true;
  });
  return {
    rows: included,
    fresh,
    stale,
    unknown,
    excluded: freshOnly ? stale + unknown : 0,
  };
}

/** Display the returned epoch only; never calculate or schedule a retry. */
export function marketEligibility(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 8_640_000_000_000_000
  )
    return null;
  return new Date(value).toISOString();
}
