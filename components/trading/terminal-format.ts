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
  if (value === 0) return "$0.00";
  if (abbreviated && value >= 1_000) return compact.format(value);
  // Significant-digit formatting drops currency cents on some Intl engines.
  // Preserve cents for ordinary prices, and retain tiny-token precision below.
  return value >= 0.01
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: Math.max(2, 4 - Math.floor(Math.log10(value))),
      }).format(value)
    : price.format(value);
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

export function riskIsStale(checkedAt: number, now: number) {
  return (
    !Number.isFinite(checkedAt) ||
    checkedAt > now + 60_000 ||
    now - checkedAt >= 600_000
  );
}

export function riskRefreshMessage(result: { checkedAt: number } | null) {
  return result
    ? `Showing mint facts checked ${new Date(result.checkedAt).toLocaleString()}.`
    : "Mint facts could not be refreshed. Any previous facts remain dated below; no new on-chain check was obtained.";
}
