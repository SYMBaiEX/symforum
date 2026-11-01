import type { TerminalMarket } from "@/lib/forum-terminal-model";
import type { MarketCapBand } from "@/lib/forum-market-cap";
import {
  marketObservation,
  marketSources,
  type MarketSortDirection,
  type MarketSortKey,
} from "./market-explorer-model";
import { safeExternalUrl } from "./terminal-format";

export type MarketExportContext = {
  band: MarketCapBand;
  platform: "all" | "bags" | "pumpfun";
  freshOnly: boolean;
  sortKey: MarketSortKey;
  sortDirection: MarketSortDirection;
  // Deliberately no search term: it can contain private identifiers.
  searchApplied: boolean;
};

const sourceHosts = new Set([
  "solanatracker.io",
  "www.solanatracker.io",
  "pump.fun",
  "bags.fm",
  "dexscreener.com",
  "www.geckoterminal.com",
  "geckoterminal.com",
]);
/** Public provider path only; queries/fragments are intentionally not exported. */
function sourcePath(value: string | null | undefined) {
  const safe = safeExternalUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (!sourceHosts.has(url.hostname) || url.port) return null;
  url.search = "";
  url.hash = "";
  return url.href;
}
/** Expand the loaded JS number's shortest round-trip representation, without rounding. */
export function marketExportNumber(
  value: number | null | undefined,
  signed = false,
) {
  if (value == null || !Number.isFinite(value) || (!signed && value < 0))
    return "null";
  if (value === 0) return "0";
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [coefficient, exponent] = text.toLowerCase().split("e");
  const sign = coefficient.startsWith("-") ? "-" : "";
  const [whole, fraction = ""] = coefficient.replace(/^-/, "").split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  return (
    sign +
    (point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`)
  );
}
function textCell(value: string | null) {
  if (value === null) return "null";
  // Quoting alone does not prevent spreadsheet formula execution. Prefix
  // dangerous text (including leading whitespace/fullwidth variants) as text.
  const escaped =
    /^\s*[=+\-@＝＋－＠]/u.test(value) || /^[\t\r\n]/.test(value)
      ? `'${value}`
      : value;
  return `"${escaped.replaceAll('"', '""')}"`;
}
export const MARKET_EXPORT_HEADERS = [
  "export_scope",
  "numeric_basis",
  "display_order",
  "mint",
  "symbol",
  "name",
  "platform",
  "price_usd",
  "market_cap_usd",
  "liquidity_usd",
  "volume_1h_usd",
  "volume_24h_usd",
  "holders",
  "change_1h_percent",
  "market_checked_at_utc",
  "market_source_state",
  "market_stale",
  "market_canonical_public_source_path",
  "holders_observed_at_utc",
  "holders_stale",
  "holders_canonical_public_source_path",
  "discovery_checked_at_utc",
  "discovery_sample_stale",
  "selected_market_cap_band",
  "selected_platform",
  "selected_fresh_only",
  "selected_sort_key",
  "selected_sort_direction",
  "search_applied",
] as const;

/** No discovery, sorting, fetching, fallback values or private fields here. */
export function marketExportCsv(
  rows: readonly TerminalMarket[],
  now: number,
  sampleStale: boolean,
  sampledAt: number | null,
  context: MarketExportContext,
) {
  const lines = rows.map((row, index) => {
    const sources = marketSources(row, now);
    return [
      textCell("displayed_loaded_sample_only"),
      textCell("loaded_javascript_number"),
      String(index + 1),
      textCell(row.mint),
      textCell(row.symbol),
      textCell(row.name),
      textCell(row.platform),
      marketExportNumber(row.priceUsd),
      marketExportNumber(row.marketCapUsd),
      marketExportNumber(row.liquidityUsd),
      marketExportNumber(row.volume1hUsd),
      marketExportNumber(row.volume24hUsd),
      marketExportNumber(row.holders),
      marketExportNumber(row.priceChange1hPercent, true),
      textCell(sources.market.dateTime),
      textCell(row.marketData?.state ?? "indexed"),
      String(sources.market.stale || (!sources.refreshed && sampleStale)),
      textCell(sourcePath(sources.sourceUrl)),
      textCell(sources.holders.dateTime),
      String(sources.holders.stale),
      textCell(sourcePath(row.sourceUrl)),
      textCell(
        sampledAt === null ? null : marketObservation(sampledAt, now).dateTime,
      ),
      String(sampleStale),
      textCell(context.band),
      textCell(context.platform),
      String(context.freshOnly),
      textCell(context.sortKey),
      textCell(context.sortDirection),
      String(context.searchApplied),
    ].join(",");
  });
  return [MARKET_EXPORT_HEADERS.join(","), ...lines].join("\r\n") + "\r\n";
}
