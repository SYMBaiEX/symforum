import {
  boundedArray,
  isSolanaAddress,
  PROMOTION_MEMO_PROGRAM,
  record,
  unsignedRaw,
} from "./forum-commerce";

export const COMMUNITY_PAYMENT_TTL_MS = 30 * 60_000;
export const COMMUNITY_SUPPORTER_TTL_MS = 10 * 60_000;
export const COMMUNITY_MAX_REWARD_LAMPORTS = 100_000_000_000n;
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export function communityText(value: string, maximum: number, minimum = 1) {
  const text = value.trim();
  if (
    text.length < minimum ||
    text.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
  )
    throw new Error(`Use between ${minimum} and ${maximum} characters.`);
  return text;
}
export function communityHttpsUrl(value: string) {
  const url = new URL(value);
  if (
    value.length > 1000 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes(".") ||
    /(^|\.)(localhost|local|internal)$/.test(url.hostname) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
  )
    throw new Error("Use a public HTTPS link without credentials.");
  return url.href;
}
export function communityAmount(value: string) {
  const raw = unsignedRaw(value);
  if (raw <= 0n || raw > COMMUNITY_MAX_REWARD_LAMPORTS)
    throw new Error("Use an amount above zero and no more than 100 SOL.");
  return String(raw);
}
export function solToLamports(value: string) {
  const normalized = value.trim().replace(/^\./, "0.");
  if (!/^(0|[1-9]\d{0,2})(\.\d{0,9})?$/.test(normalized))
    throw new Error("Use a SOL amount with up to nine decimal places.");
  const [whole, fraction = ""] = normalized.split(".");
  return communityAmount(
    String(BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"))),
  );
}
export function lamportsToSol(raw: string) {
  const n = unsignedRaw(raw),
    fractional = String(n % 1_000_000_000n)
      .padStart(9, "0")
      .replace(/0+$/, "");
  return `${n / 1_000_000_000n}${fractional ? `.${fractional}` : ""}`;
}
export type CommunityPaymentBinding = {
  wallet: string;
  recipient: string;
  amountLamports: string;
  reference: string;
  memo: string;
  createdAt: number;
  expiresAt: number;
};
/** Solana Pay is an explicit external-wallet payment request, not an app broadcast. */
export function communityPaymentUrl(intent: CommunityPaymentBinding) {
  if (
    ![intent.wallet, intent.recipient, intent.reference].every(isSolanaAddress)
  )
    throw new Error("Invalid payment address.");
  communityAmount(intent.amountLamports);
  const params = new URLSearchParams({
    amount: lamportsToSol(intent.amountLamports),
    reference: intent.reference,
    memo: intent.memo,
    label: "SYMBaiEX Forum",
    message: "One-time community payment. Confirm payer, recipient and amount.",
  });
  return `solana:${intent.recipient}?${params}`;
}

export type CommunityReceiptResult = {
  valid: boolean;
  issue: string;
  finalizedAt: number | null;
  slot: number | null;
};
/** Input must be a server-fetched getTransaction(commitment:finalized) result. */
export function verifyCommunityReceipt(
  value: unknown,
  intent: CommunityPaymentBinding,
  signature: string,
): CommunityReceiptResult {
  const reject = (issue: string): CommunityReceiptResult => ({
    valid: false,
    issue,
    finalizedAt: null,
    slot: null,
  });
  try {
    const tx = record(value),
      meta = record(tx.meta),
      transaction = record(tx.transaction),
      message = record(transaction.message);
    if (!tx.meta || meta.err !== null)
      return reject("transaction_failed_or_unavailable");
    if (
      !Number.isSafeInteger(tx.slot) ||
      (tx.slot as number) < 0 ||
      !Number.isSafeInteger(tx.blockTime)
    )
      return reject("receipt_time_unavailable");
    const finalizedAt = (tx.blockTime as number) * 1000;
    if (finalizedAt < intent.createdAt - 5000 || finalizedAt > intent.expiresAt)
      return reject("outside_payment_window");
    if (boundedArray(transaction.signatures, 32)[0] !== signature)
      return reject("signature_mismatch");
    const keys = boundedArray(message.accountKeys, 256).map(record);
    if (
      keys[0]?.pubkey !== intent.wallet ||
      keys[0]?.signer !== true ||
      !keys.some((k) => k.pubkey === intent.reference && k.signer === false)
    )
      return reject("payer_or_reference_mismatch");
    const instructions = boundedArray(message.instructions, 64).map(record);
    const memos = instructions.filter(
      (ix) => ix.programId === PROMOTION_MEMO_PROGRAM,
    );
    if (memos.length !== 1 || memos[0].parsed !== intent.memo)
      return reject("memo_mismatch");
    // Only a direct system transfer counts, not a balance delta or arbitrary program log.
    const transfers = instructions.filter(
      (ix) =>
        ix.programId === SYSTEM_PROGRAM &&
        record(ix.parsed).type === "transfer",
    );
    if (transfers.length !== 1) return reject("ambiguous_transfer");
    const info = record(record(transfers[0].parsed).info);
    if (
      info.source !== intent.wallet ||
      info.destination !== intent.recipient ||
      !Number.isSafeInteger(info.lamports) ||
      String(info.lamports) !== intent.amountLamports
    )
      return reject("payment_mismatch");
    // Reject another instruction that can debit/close the recipient, not just a matching transfer.
    const permitted = new Set([
      SYSTEM_PROGRAM,
      PROMOTION_MEMO_PROGRAM,
      "ComputeBudget111111111111111111111111111111",
    ]);
    if (
      instructions.some((ix) => !permitted.has(String(ix.programId))) ||
      instructions.filter((ix) => ix.programId === SYSTEM_PROGRAM).length !==
        1 ||
      (Array.isArray(meta.innerInstructions) &&
        meta.innerInstructions.length > 0)
    )
      return reject("unsupported_payment_instructions");
    const destination = keys.findIndex((k) => k.pubkey === intent.recipient);
    const pre = boundedArray(meta.preBalances, 256),
      post = boundedArray(meta.postBalances, 256);
    if (
      destination < 0 ||
      !Number.isSafeInteger(pre[destination]) ||
      !Number.isSafeInteger(post[destination]) ||
      BigInt(post[destination] as number) -
        BigInt(pre[destination] as number) !==
        BigInt(intent.amountLamports)
    )
      return reject("recipient_balance_mismatch");
    return {
      valid: true,
      issue: "finalized",
      finalizedAt,
      slot: tx.slot as number,
    };
  } catch {
    return reject("invalid_receipt");
  }
}
