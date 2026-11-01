import { isMarketCapBand, type MarketCapBand } from "@/lib/forum-market-cap";
import type {
  MarketSortDirection,
  MarketSortKey,
} from "./market-explorer-model";

export const MARKET_VIEW_STORAGE_KEY = "symforum.public-market-view";
export type MarketViewPreferences = {
  band: MarketCapBand;
  platform: "all" | "bags" | "pumpfun";
  freshOnly: boolean;
  sortKey: MarketSortKey;
  sortDirection: MarketSortDirection;
};
const fields = [
  "version",
  "band",
  "platform",
  "freshOnly",
  "sortKey",
  "sortDirection",
];
const sortKeys = [
  "price",
  "change1h",
  "marketCap",
  "liquidity",
  "volume1h",
  "volume24h",
  "holders",
];
type ReadResult =
  | { state: "saved"; view: MarketViewPreferences }
  | { state: "missing" | "invalid" | "unsupported" | "unavailable" };
type DeviceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function parseMarketViewPreferences(raw: string | null): ReadResult {
  if (raw === null) return { state: "missing" };
  if (raw.length > 1024) return { state: "invalid" };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { state: "invalid" };
    const item = value as Record<string, unknown>;
    if (Object.hasOwn(item, "version") && item.version !== 1)
      return { state: "unsupported" };
    if (
      item.version !== 1 ||
      Object.keys(item).length !== fields.length ||
      Object.keys(item).some((key) => !fields.includes(key)) ||
      !isMarketCapBand(item.band) ||
      typeof item.platform !== "string" ||
      !["all", "bags", "pumpfun"].includes(item.platform) ||
      typeof item.freshOnly !== "boolean" ||
      typeof item.sortKey !== "string" ||
      !sortKeys.includes(item.sortKey) ||
      (item.sortDirection !== "asc" && item.sortDirection !== "desc")
    )
      return { state: "invalid" };
    return {
      state: "saved",
      view: {
        band: item.band,
        platform: item.platform as MarketViewPreferences["platform"],
        freshOnly: item.freshOnly,
        sortKey: item.sortKey as MarketSortKey,
        sortDirection: item.sortDirection,
      },
    };
  } catch {
    return { state: "invalid" };
  }
}

export function readMarketViewPreferences(storage: DeviceStorage): ReadResult {
  try {
    return parseMarketViewPreferences(storage.getItem(MARKET_VIEW_STORAGE_KEY));
  } catch {
    return { state: "unavailable" };
  }
}

export function saveMarketViewPreferences(
  storage: DeviceStorage,
  view: MarketViewPreferences,
): ReadResult {
  // Construct only public controls: never spread callers, data, identity or search text.
  const raw = JSON.stringify({
    version: 1,
    band: view.band,
    platform: view.platform,
    freshOnly: view.freshOnly,
    sortKey: view.sortKey,
    sortDirection: view.sortDirection,
  });
  const valid = parseMarketViewPreferences(raw);
  if (valid.state !== "saved") return valid;
  const existing = readMarketViewPreferences(storage);
  // Unrecognized, malformed and newer bytes are never overwritten or removed.
  if (existing.state !== "saved" && existing.state !== "missing")
    return existing;
  try {
    storage.setItem(MARKET_VIEW_STORAGE_KEY, raw);
    return valid;
  } catch {
    return { state: "unavailable" };
  }
}

export function forgetMarketViewPreferences(
  storage: DeviceStorage,
): ReadResult {
  const existing = readMarketViewPreferences(storage);
  if (existing.state !== "saved") return existing;
  try {
    storage.removeItem(MARKET_VIEW_STORAGE_KEY);
    return { state: "missing" };
  } catch {
    return { state: "unavailable" };
  }
}
