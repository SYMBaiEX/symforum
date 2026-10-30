import type { TerminalMarket } from "@/lib/forum-terminal-model";

const price = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 5,
});
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumSignificantDigits: 4,
});

export function marketMoney(
  value: number | null | undefined,
  abbreviated = false,
) {
  if (value == null || !Number.isFinite(value) || value < 0)
    return "Unavailable";
  return (abbreviated && value >= 1_000 ? compact : price).format(value);
}

export function marketQuantity(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) || value < 0
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
        value,
      );
}

export function shortMint(value: string) {
  return value.length > 16 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

export function safeExternalUrl(value: string | null | undefined) {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function searchMarkets(markets: TerminalMarket[], search: string) {
  const normalized = search.trim().toLocaleLowerCase("en-US");
  if (!normalized) return markets;
  return markets.filter((market) =>
    [market.name, market.symbol, market.mint].some((value) =>
      value.toLocaleLowerCase("en-US").includes(normalized),
    ),
  );
}

export function balanceLabel(raw: string, decimals: number) {
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  )
    return "Unavailable";
  const digits = raw.padStart(decimals + 1, "0");
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}
