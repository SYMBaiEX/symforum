import {
  getBase64Encoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";
import { record } from "./swap-router";

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const RECONCILIATION_QUIET_MS = 15 * 60_000;
export type ExpiredSwap = {
  wallet: string;
  createdAt: number;
  expiresAt: number;
  status: string;
  issue?: string;
  signature?: string;
  transactionBase64?: string;
  messageHash?: string;
  lastValidBlockHeight?: number;
  simulationSlot?: number;
  transactionVersion?: number;
};
export type RpcExpiryProof = {
  checkedAt: number;
  genesis: string;
  invalidAtSlot: number;
  finalizedHeight: number;
  firstAvailableSlot: number;
  historyCount: number;
  newestHistorySlot: number;
  newestHistoryTime: number;
  historyHash: string;
};
export async function reconciliationHash(value: unknown) {
  const normalized =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, (value as Record<string, unknown>)[key]]),
        )
      : value;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(normalized)),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function requireExpiredUnsignedHold(row: ExpiredSwap, now: number) {
  if (
    row.status !== "held" ||
    row.issue !== "wallet_outcome_unknown" ||
    row.signature ||
    !row.transactionBase64 ||
    !/^[a-f0-9]{64}$/.test(row.messageHash ?? "") ||
    !Number.isSafeInteger(row.lastValidBlockHeight) ||
    Number(row.lastValidBlockHeight) <= 0 ||
    !Number.isSafeInteger(row.simulationSlot) ||
    Number(row.simulationSlot) <= 0 ||
    !Number.isSafeInteger(row.createdAt) ||
    !Number.isSafeInteger(row.expiresAt) ||
    row.expiresAt <= row.createdAt ||
    now < row.expiresAt + RECONCILIATION_QUIET_MS
  )
    throw new Error("Hold is not eligible for expired reconciliation.");
}
export async function preparedBlockhash(row: ExpiredSwap) {
  if (!row.transactionBase64 || row.transactionBase64.length > 6000)
    throw new Error("Invalid saved wire.");
  const wire = getBase64Encoder().encode(row.transactionBase64);
  if (wire.length > 4096) throw new Error("Invalid saved wire.");
  const tx = getTransactionDecoder().decode(wire);
  const message = getCompiledTransactionMessageDecoder().decode(
    tx.messageBytes,
  );
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(tx.messageBytes)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (
    digest !== row.messageHash ||
    message.staticAccounts[0] !== row.wallet ||
    message.version !== row.transactionVersion ||
    ![0, 1].includes(Number(message.version)) ||
    Object.keys(tx.signatures).length !== 1 ||
    tx.signatures[row.wallet as keyof typeof tx.signatures] !== null
  )
    throw new Error("Saved transaction binding changed.");
  return String(message.lifetimeToken);
}
/** Reject even unrelated activity: this narrow recovery only proves an entirely quiet approval window. */
export async function proveQuietHistory(history: unknown, row: ExpiredSwap) {
  if (!Array.isArray(history) || history.length < 1 || history.length > 10)
    throw new Error("History coverage is inconclusive.");
  let previous = Infinity;
  const signatures = new Set<string>();
  const entries = history.map((raw) => {
    const item = record(raw);
    if (
      !Number.isSafeInteger(item.slot) ||
      Number(item.slot) < 0 ||
      Number(item.slot) > previous ||
      !Number.isSafeInteger(item.blockTime) ||
      Number(item.blockTime) < 0 ||
      item.confirmationStatus !== "finalized" ||
      typeof item.signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(item.signature) ||
      signatures.has(item.signature) ||
      Number(item.slot) >= Number(row.simulationSlot) ||
      Number(item.blockTime) * 1000 >= row.createdAt - 120_000
    )
      throw new Error("History does not prove a quiet approval window.");
    previous = Number(item.slot);
    signatures.add(item.signature);
    return {
      signature: item.signature,
      slot: Number(item.slot),
      blockTime: Number(item.blockTime),
    };
  });
  return {
    historyCount: entries.length,
    newestHistorySlot: Math.max(...entries.map((r) => r.slot)),
    newestHistoryTime: Math.max(...entries.map((r) => r.blockTime)),
    historyHash: await reconciliationHash(entries),
  };
}
export function requireExpiryProof(
  row: ExpiredSwap,
  proof: RpcExpiryProof,
  now: number,
) {
  const numbers = [
    proof.checkedAt,
    proof.invalidAtSlot,
    proof.finalizedHeight,
    proof.firstAvailableSlot,
    proof.historyCount,
    proof.newestHistorySlot,
    proof.newestHistoryTime,
  ];
  if (
    numbers.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    proof.genesis !== MAINNET_GENESIS ||
    proof.checkedAt > now ||
    now - proof.checkedAt > 60_000 ||
    proof.invalidAtSlot <= Number(row.simulationSlot) ||
    proof.finalizedHeight <= Number(row.lastValidBlockHeight) + 32 ||
    proof.firstAvailableSlot > Number(row.simulationSlot) ||
    proof.historyCount < 1 ||
    proof.historyCount > 10 ||
    proof.newestHistorySlot >= Number(row.simulationSlot) ||
    proof.newestHistoryTime * 1000 >= row.createdAt - 120_000 ||
    !/^[a-f0-9]{64}$/.test(proof.historyHash)
  )
    throw new Error("Expiry evidence is incomplete or stale.");
}
