import { SYMF_TOKEN } from "./symf-token";

export type SymfStats = {
  marketCap: number | null;
  fdv: number | null;
  liquidity: number | null;
  volume24h: number | null;
};
export type SymfTrade = {
  id: string;
  time: number;
  hash: string;
  side: "buy" | "sell";
  valueUsd: number;
  amount: number;
  priceUsd: number | null;
};
export type SymfMarketOverview = {
  checkedAt: number;
  marketCheckedAt?: number;
  stats: SymfStats | null;
  trades: SymfTrade[] | null;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function number(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "")
    return null;
  if (
    typeof value === "string" &&
    !/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
  )
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Object.is(parsed, -0)
      ? 0
      : parsed
    : null;
}

export type MarketBinding = { mint: string; pool: string; quote: string };
const symfBinding: MarketBinding = {
  mint: SYMF_TOKEN.mint,
  pool: SYMF_TOKEN.pool,
  quote: "So11111111111111111111111111111111111111112",
};

export function parseMarketStats(
  value: unknown,
  expected: MarketBinding,
): SymfStats {
  if (!Array.isArray(value)) throw Error("invalid_market_snapshot");
  const pair = value
    .map(record)
    .find(
      (p) =>
        p.chainId === "solana" &&
        p.pairAddress === expected.pool &&
        record(p.baseToken).address === expected.mint &&
        record(p.quoteToken).address === expected.quote,
    );
  if (!pair) throw Error("wrong_market_token");
  return {
    marketCap: number(pair.marketCap),
    fdv: number(pair.fdv),
    liquidity: number(record(pair.liquidity).usd),
    volume24h: number(record(pair.volume).h24),
  };
}

export function parseMarketTrades(
  value: unknown,
  now: number,
  expected: Pick<MarketBinding, "mint" | "quote">,
): SymfTrade[] {
  const rows = record(value).data;
  if (!Array.isArray(rows) || rows.length > 300)
    throw Error("invalid_trade_response");
  const result: SymfTrade[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const entry = record(row),
      a = record(entry.attributes);
    if (
      typeof entry.id !== "string" ||
      !entry.id.startsWith("solana_") ||
      entry.id.length > 220 ||
      seen.has(entry.id)
    )
      continue;
    const side = a.kind;
    if (side !== "buy" && side !== "sell") continue;
    if (
      side === "buy"
        ? a.to_token_address !== expected.mint ||
          a.from_token_address !== expected.quote
        : a.from_token_address !== expected.mint ||
          a.to_token_address !== expected.quote
    )
      continue;
    const time =
      typeof a.block_timestamp === "string"
        ? Date.parse(a.block_timestamp)
        : NaN;
    const amount = number(
      side === "buy" ? a.to_token_amount : a.from_token_amount,
    );
    const priceUsd = number(
      side === "buy" ? a.price_to_in_usd : a.price_from_in_usd,
    );
    const valueUsd = number(a.volume_in_usd);
    if (
      !Number.isFinite(time) ||
      time <= 0 ||
      time > now + 120_000 ||
      typeof a.tx_hash !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(a.tx_hash) ||
      amount === null ||
      valueUsd === null
    )
      continue;
    seen.add(entry.id);
    result.push({
      id: entry.id,
      time,
      hash: a.tx_hash,
      side,
      valueUsd,
      amount,
      priceUsd,
    });
  }
  return result.sort((a, b) => b.time - a.time).slice(0, 20);
}

export function parseSymfStats(value: unknown): SymfStats {
  return parseMarketStats(value, symfBinding);
}

export function parseSymfTrades(value: unknown, now: number): SymfTrade[] {
  return parseMarketTrades(value, now, symfBinding);
}
