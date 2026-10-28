import { telegramHtml } from "./telegram-community";

export const SYMF_MINT = "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump";
export const SYMF_FEED_TOPIC = 310;
export const GECKO_BASE =
  "https://api.geckoterminal.com/api/v2/networks/solana";
const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const signature = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const decimal = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length < 160 &&
  /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(v) &&
  Number.isFinite(Number(v));
export type FeedBuy = {
  key: string;
  pool: string;
  tx: string;
  occurredAt: number;
  tokens: string;
  spent: string;
  spentSymbol: string;
  usd?: string;
  anomalous: boolean;
};

export function symfPools(input: unknown) {
  if (!object(input) || !Array.isArray(input.data) || input.data.length > 20)
    throw Error("invalid_pool_response");
  const pools: string[] = [];
  for (const r of input.data) {
    if (
      !object(r) ||
      !object(r.attributes) ||
      !address.test(String(r.attributes.address)) ||
      !object(r.relationships)
    )
      continue;
    const ids = [
      r.relationships.base_token,
      r.relationships.quote_token,
    ].flatMap((t) => (object(t) && object(t.data) ? [t.data.id] : []));
    if (ids.includes(`solana_${SYMF_MINT}`))
      pools.push(String(r.attributes.address));
  }
  return { pools: [...new Set(pools)], truncated: input.data.length === 20 };
}

export function poolBuys(
  input: unknown,
  pool: string,
  since: number,
  now: number,
) {
  if (
    !address.test(pool) ||
    !object(input) ||
    !Array.isArray(input.data) ||
    input.data.length > 300
  )
    throw Error("invalid_trade_response");
  const ids: string[] = [],
    times: number[] = [],
    buys: FeedBuy[] = [];
  for (const row of input.data) {
    if (
      !object(row) ||
      typeof row.id !== "string" ||
      row.id.length > 240 ||
      !/^[a-zA-Z0-9_-]+$/.test(row.id) ||
      !object(row.attributes)
    )
      throw Error("invalid_trade_row");
    const a = row.attributes;
    const at =
      typeof a.block_timestamp === "string"
        ? Date.parse(a.block_timestamp)
        : NaN;
    if (!Number.isFinite(at) || at > now + 60_000)
      throw Error("invalid_trade_time");
    ids.push(row.id);
    times.push(at);
    // Direction is defined by the exact mint received, including quote-token pools.
    // There is no USD floor or MEV/anomaly exclusion.
    if (
      at < since ||
      a.to_token_address !== SYMF_MINT ||
      a.from_token_address === SYMF_MINT ||
      !["buy", "sell"].includes(String(a.kind))
    )
      continue;
    if (
      !signature.test(String(a.tx_hash)) ||
      !decimal(a.to_token_amount) ||
      Number(a.to_token_amount) <= 0 ||
      !decimal(a.from_token_amount)
    )
      throw Error("invalid_buy_amount");
    buys.push({
      key: `${pool}:${row.id}`,
      pool,
      tx: String(a.tx_hash),
      occurredAt: at,
      tokens: a.to_token_amount,
      spent: a.from_token_amount,
      spentSymbol:
        a.from_token_address === "So11111111111111111111111111111111111111112"
          ? "SOL"
          : "quote token",
      ...(decimal(a.volume_in_usd) ? { usd: a.volume_in_usd } : {}),
      anomalous: a.is_anomalous === true,
    });
  }
  return {
    ids,
    buys,
    oldestAt: times.length ? Math.min(...times) : null,
    headId: ids[0] ?? null,
    headAt: times[0] ?? null,
  };
}

export function renderFeedBuys(buys: FeedBuy[]) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const quantity = (s: string) =>
    Number(s) > 0 && Number(s) < 0.000001
      ? "<0.000001"
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(
          Number(s),
        );
  const money = (s?: string) =>
    s === undefined
      ? "USD unavailable"
      : Number(s) > 0 && Number(s) < 0.01
        ? "<$0.01"
        : new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
          }).format(Number(s));
  return (
    `<b>$SYMF Feed · ${buys.length} ${buys.length === 1 ? "buy" : "buys"}</b>\nNo minimum amount · Times in Chicago\n\n` +
    buys
      .map(
        (b) =>
          `<b>${time.format(b.occurredAt)}</b> · ${telegramHtml(money(b.usd))}\n${telegramHtml(quantity(b.spent))} ${b.spentSymbol} → ${telegramHtml(quantity(b.tokens))} SYMF${b.anomalous ? " · ⚑ Provider flagged" : ""}\n<a href="https://solscan.io/tx/${b.tx}">View transaction</a>`,
      )
      .join("\n\n") +
    `\n\nSource: <a href="https://www.geckoterminal.com/solana/tokens/${SYMF_MINT}">GeckoTerminal</a> · Indexed trades may arrive late.\n<a href="https://forum.symbaiex.com">SYMBaiEX Forum</a>`
  );
}
