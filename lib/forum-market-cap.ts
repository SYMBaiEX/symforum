/** Actual circulating market capitalization only. Never substitute FDV. */
export const MARKET_CAP_BANDS = [
  { id: "all", label: "All market caps", minimumUsd: null, maximumUsd: null },
  { id: "under50k", label: "Under $50k", minimumUsd: 0, maximumUsd: 50_000 },
  {
    id: "50k100k",
    label: "$50k–$100k",
    minimumUsd: 50_000,
    maximumUsd: 100_000,
  },
  {
    id: "100k500k",
    label: "$100k–$500k",
    minimumUsd: 100_000,
    maximumUsd: 500_000,
  },
  {
    id: "500k1m",
    label: "$500k–$1m",
    minimumUsd: 500_000,
    maximumUsd: 1_000_000,
  },
  {
    id: "1m10m",
    label: "$1m–$10m",
    minimumUsd: 1_000_000,
    maximumUsd: 10_000_000,
  },
  {
    id: "over10m",
    label: "$10m and above",
    minimumUsd: 10_000_000,
    maximumUsd: null,
  },
  {
    id: "unknown",
    label: "Market cap unavailable",
    minimumUsd: null,
    maximumUsd: null,
  },
] as const;

export type MarketCapBand = (typeof MARKET_CAP_BANDS)[number]["id"];
export type ClassifiedMarketCapBand = Exclude<MarketCapBand, "all">;

export const classifyMarketCap = (
  value: number | null | undefined,
): ClassifiedMarketCapBand => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return "unknown";
  const match = MARKET_CAP_BANDS.find(
    (band) =>
      band.minimumUsd !== null &&
      value >= band.minimumUsd &&
      (band.maximumUsd === null || value < band.maximumUsd),
  );
  return (match?.id as ClassifiedMarketCapBand) ?? "unknown";
};

export const isMarketCapBand = (value: unknown): value is MarketCapBand =>
  typeof value === "string" &&
  MARKET_CAP_BANDS.some((band) => band.id === value);

export const matchesMarketCap = (
  value: number | null | undefined,
  band: MarketCapBand,
) => band === "all" || classifyMarketCap(value) === band;

/** Rotation changes the existing ranking request, not its cadence or quota. */
export const DISCOVERY_CAP_ROTATION = [
  "50k100k",
  "500k1m",
  "under50k",
  "100k500k",
  "1m10m",
  "over10m",
  "all",
] as const satisfies readonly MarketCapBand[];
