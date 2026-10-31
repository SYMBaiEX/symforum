import { address, getAddressEncoder, getBase58Decoder } from "@solana/kit";
import { SYMF_TOKEN } from "./symf-token";

export const COMMERCE_MINT = SYMF_TOKEN.mint;
export const COMMERCE_POOL = SYMF_TOKEN.pool;
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const PROMOTION_MEMO_PROGRAM =
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const BENEFIT_TTL_MS = 60_000;
export const CHECKOUT_TTL_MS = 10 * 60_000;
export const MAX_PROMOTION_LANES = 5;
export const MAX_PROMOTION_QUEUE_MS = 7 * 86_400_000;

export function isSolanaAddress(value: string): boolean {
  try {
    return (
      value.length >= 32 &&
      value.length <= 44 &&
      getAddressEncoder().encode(address(value)).length === 32
    );
  } catch {
    return false;
  }
}
export function publicReference(bytes: Uint8Array) {
  if (bytes.length !== 32) throw new Error("Invalid reference bytes.");
  return getBase58Decoder().decode(bytes);
}
/** Discovery only: a uniquely linked address still needs server-side mint verification. */
export function linkedMintCandidate(text: string): string | null {
  if (text.length > 100000) return null;
  const candidates = new Set<string>();
  let links = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>()[\]"']+/g)) {
    if (++links > 100) return null;
    try {
      const url = new URL(match[0]);
      if (url.protocol !== "https:" || url.username || url.password || url.port)
        continue;
      const host = url.hostname.replace(/^www\./, ""),
        parts = url.pathname.replace(/\/$/, "").split("/").filter(Boolean);
      const mint =
        host === "pump.fun" && parts.length === 2 && parts[0] === "coin"
          ? parts[1]
          : host === "bags.fm" && parts.length === 1
            ? parts[0]
            : null;
      if (mint && isSolanaAddress(mint)) candidates.add(mint);
      if (candidates.size > 1) return null;
    } catch {
      /* Malformed/untrusted links cannot identify a trading asset. */
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}
export function postHasMintReference(text: string): boolean {
  return /https:\/\/(?:www\.)?(?:pump\.fun\/coin\/|bags\.fm\/)|\b(?:mint(?: address)?|contract(?: address)?|ca)\s*:/i.test(
    text,
  );
}
/** Exact post identity only: recognized project links or an explicitly labeled
 * Solana mint. Tickers, arbitrary wallet addresses and competing mints cannot
 * choose a trading asset. */
export function postMintCandidate(text: string): string | null {
  if (text.length > 100_000) return null;
  const candidates = new Set<string>();
  const links = text.match(/https?:\/\/[^\s<>()[\]"']+/g) ?? [];
  if (links.length > 100) return null;
  for (const link of links) {
    const mint = linkedMintCandidate(link);
    if (mint) candidates.add(mint);
  }
  for (const match of text.matchAll(
    /\b(?:mint(?: address)?|contract(?: address)?|ca)\s*:\s*(?:\[\/?b\]\s*)*([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/gi,
  )) {
    if (isSolanaAddress(match[1])) candidates.add(match[1]);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}
export function unsignedRaw(value: string) {
  if (
    !/^(0|[1-9][0-9]{0,19})$/.test(value) ||
    BigInt(value) > 18_446_744_073_709_551_615n
  )
    throw new Error("Invalid token amount.");
  return BigInt(value);
}
function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const n = value === undefined ? fallback : Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}
export function commerceConfig(values: {
  FORUM_SWAPS_ENABLED?: string;
  FORUM_PROMOTIONS_ENABLED?: string;
  FORUM_COMMERCE_TREASURY?: string;
  FORUM_PLATFORM_FEE_BPS?: string;
  FORUM_PROMOTION_AMOUNT_RAW?: string;
  FORUM_PROMOTION_DURATION_HOURS?: string;
  FORUM_COMMERCE_RPC_URL?: string;
  JUPITER_API_KEY?: string;
  JUPITER_REFERRAL_ACCOUNT?: string;
  FORUM_SWAP_MANAGED_ENABLED?: string;
  FORUM_SWAP_SIGNATURE_FIRST_ENABLED?: string;
}) {
  const treasury = values.FORUM_COMMERCE_TREASURY?.trim() ?? "";
  const fee = integer(values.FORUM_PLATFORM_FEE_BPS, 50, 0, 100);
  const hours = integer(values.FORUM_PROMOTION_DURATION_HOURS, 24, 1, 168);
  let promotionAmountRaw = values.FORUM_PROMOTION_AMOUNT_RAW ?? "10000000000";
  try {
    if (
      unsignedRaw(promotionAmountRaw) === 0n ||
      unsignedRaw(promotionAmountRaw) % 2n !== 0n
    )
      promotionAmountRaw = "";
  } catch {
    promotionAmountRaw = "";
  }
  let rpcUrl: string | null = null;
  try {
    const u = new URL(values.FORUM_COMMERCE_RPC_URL ?? "");
    if (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !["localhost", "127.0.0.1", "::1"].includes(u.hostname)
    )
      rpcUrl = u.toString();
  } catch {
    /* Fail closed until a first-party RPC is configured. */
  }
  const ready =
    isSolanaAddress(COMMERCE_MINT) &&
    isSolanaAddress(treasury) &&
    rpcUrl !== null &&
    fee !== null &&
    hours !== null &&
    promotionAmountRaw !== "";
  const managed = values.FORUM_SWAP_MANAGED_ENABLED === "true";
  const managedReady =
    !managed ||
    (fee === 50 &&
      Boolean(values.JUPITER_API_KEY) &&
      isSolanaAddress(values.JUPITER_REFERRAL_ACCOUNT ?? "") &&
      values.FORUM_SWAP_SIGNATURE_FIRST_ENABLED === "true");
  return {
    swapsEnabled:
      values.FORUM_SWAPS_ENABLED === "true" && ready && managedReady,
    promotionsEnabled: values.FORUM_PROMOTIONS_ENABLED === "true" && ready,
    treasury: isSolanaAddress(treasury) ? treasury : null,
    platformFeeBps: fee ?? 50,
    managedEnabled: managed,
    referralAccount: values.JUPITER_REFERRAL_ACCOUNT,
    promotionAmountRaw: promotionAmountRaw || "10000000000",
    promotionDurationMs: (hours ?? 24) * 3_600_000,
    promotionBurnBps: 5000,
    holderThresholdUsd: 1,
    holderCacheTtlMs: BENEFIT_TTL_MS,
    maxPromotedPerBoard: MAX_PROMOTION_LANES,
    rpcUrl,
    jupiterApiKey: values.JUPITER_API_KEY,
  };
}

export function priceNanoUsd(price: unknown): bigint {
  if (
    typeof price !== "string" ||
    !/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,18})?$/.test(price)
  )
    throw new Error("Invalid price.");
  const [whole, fractional = ""] = price.split(".");
  const result =
    BigInt(whole) * 1_000_000_000n +
    BigInt(fractional.padEnd(9, "0").slice(0, 9));
  if (result <= 0n) throw new Error("Price unavailable.");
  return result;
}
export function holderEligible(
  balanceRaw: string,
  decimals: number,
  price: string,
): boolean {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18)
    return false;
  try {
    return (
      unsignedRaw(balanceRaw) * priceNanoUsd(price) >
      1_000_000_000n * 10n ** BigInt(decimals)
    );
  } catch {
    return false;
  }
}

type Interval = { lane: number; startsAt: number; endsAt: number };
export function allocatePromotionLane(
  now: number,
  duration: number,
  intervals: Interval[],
): Interval {
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(duration) ||
    duration <= 0 ||
    duration > 7 * 86_400_000
  )
    throw new Error("Invalid promotion duration.");
  // Book the earliest gap in each lane, then choose earliest start/lower lane.
  // Reservations and paid placements are supplied from one indexed transaction.
  let chosen: Interval | undefined;
  for (let lane = 0; lane < MAX_PROMOTION_LANES; lane++) {
    let startsAt = now;
    const rows = intervals
      .filter((r) => r.lane === lane && r.endsAt > now)
      .sort((a, b) => a.startsAt - b.startsAt);
    for (const row of rows) {
      if (startsAt + duration <= row.startsAt) break;
      startsAt = Math.max(startsAt, row.endsAt);
    }
    const result = { lane, startsAt, endsAt: startsAt + duration };
    if (!chosen || result.startsAt < chosen.startsAt) chosen = result;
  }
  if (!chosen || chosen.startsAt > now + MAX_PROMOTION_QUEUE_MS)
    throw new Error("This board's promotion queue is full.");
  return chosen;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function boundedArray(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("Invalid chain response.");
  return value;
}

/** Check only a finalized RPC response fetched by the server for this signature. */
export function verifyPromotionReceipt(
  value: unknown,
  intent: {
    wallet: string;
    treasury: string;
    mint: string;
    tokenProgram: string;
    amountRaw: string;
    treasuryAmountRaw: string;
    burnAmountRaw: string;
    decimals: number;
    reference: string;
    createdAt: number;
    checkoutExpiresAt: number;
  },
): { valid: boolean; reason: string; blockTime: number | null } {
  try {
    const tx = record(value),
      meta = record(tx.meta),
      transaction = record(tx.transaction),
      message = record(transaction.message);
    if (!tx.meta || meta.err !== null)
      return { valid: false, reason: "transaction_failed", blockTime: null };
    if (!Number.isSafeInteger(tx.blockTime))
      return { valid: false, reason: "receipt_time_missing", blockTime: null };
    const time = (tx.blockTime as number) * 1000;
    if (time < intent.createdAt - 5000 || time > intent.checkoutExpiresAt)
      return {
        valid: false,
        reason: "payment_outside_checkout",
        blockTime: time,
      };
    const keys = boundedArray(message.accountKeys, 256).map(record);
    if (keys[0]?.pubkey !== intent.wallet || keys[0]?.signer !== true)
      return { valid: false, reason: "payer_mismatch", blockTime: time };
    const instructions = boundedArray(message.instructions, 64).map(record);
    const memos = instructions.filter(
      (ix) => ix.programId === PROMOTION_MEMO_PROGRAM,
    );
    if (
      memos.length !== 1 ||
      memos[0].parsed !== `SYMF-PROMOTION:${intent.reference}`
    )
      return { valid: false, reason: "reference_mismatch", blockTime: time };
    const payments = instructions.filter(
      (ix) =>
        ix.programId === intent.tokenProgram &&
        record(ix.parsed).type === "transferChecked",
    );
    if (payments.length !== 1)
      return { valid: false, reason: "ambiguous_transfer", blockTime: time };
    const info = record(record(payments[0].parsed).info),
      amount = record(info.tokenAmount);
    if (
      info.authority !== intent.wallet ||
      info.mint !== intent.mint ||
      amount.amount !== intent.treasuryAmountRaw ||
      amount.decimals !== intent.decimals
    )
      return { valid: false, reason: "payment_mismatch", blockTime: time };
    const burns = instructions.filter(
      (ix) =>
        ix.programId === intent.tokenProgram &&
        record(ix.parsed).type === "burnChecked",
    );
    if (burns.length !== 1)
      return { valid: false, reason: "burn_missing", blockTime: time };
    const burn = record(record(burns[0].parsed).info),
      burned = record(burn.tokenAmount);
    if (
      burn.authority !== intent.wallet ||
      burn.account !== info.source ||
      burn.mint !== intent.mint ||
      burned.amount !== intent.burnAmountRaw ||
      burned.decimals !== intent.decimals ||
      unsignedRaw(intent.treasuryAmountRaw) +
        unsignedRaw(intent.burnAmountRaw) !==
        unsignedRaw(intent.amountRaw)
    )
      return { valid: false, reason: "burn_mismatch", blockTime: time };
    const source = keys.findIndex((k) => k.pubkey === info.source);
    const sourceBalance = boundedArray(meta.preTokenBalances, 256)
      .map(record)
      .find((b) => b.accountIndex === source);
    if (
      !sourceBalance ||
      sourceBalance.owner !== intent.wallet ||
      sourceBalance.mint !== intent.mint ||
      sourceBalance.programId !== intent.tokenProgram
    )
      return { valid: false, reason: "source_owner_mismatch", blockTime: time };
    const destination = keys.findIndex((k) => k.pubkey === info.destination);
    const balances = boundedArray(meta.postTokenBalances, 256).map(record);
    const balance = balances.find((b) => b.accountIndex === destination);
    if (
      !balance ||
      balance.owner !== intent.treasury ||
      balance.mint !== intent.mint ||
      balance.programId !== intent.tokenProgram
    )
      return { valid: false, reason: "treasury_mismatch", blockTime: time };
    return { valid: true, reason: "finalized", blockTime: time };
  } catch {
    return { valid: false, reason: "invalid_receipt", blockTime: null };
  }
}
