import {
  getBase64Encoder,
  getBase58Decoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";
import { record } from "./swap-router";
import { reconciliationHash } from "./swap-reconciliation";

/** Read-only finalized receipt proof. Never equates a missing response to failure. */
export async function inspectSwapReceipt(
  value: unknown,
  expected: {
    wallet: string;
    signature: string;
    messageHash: string;
    simulationSlot: number;
  },
): Promise<{
  outcome: "confirmed" | "chain_failed";
  receiptHash: string;
} | null> {
  if (value === null) return null;
  const receipt = record(value),
    meta = record(receipt.meta),
    wire = receipt.transaction;
  if (
    !Number.isSafeInteger(receipt.slot) ||
    Number(receipt.slot) < expected.simulationSlot ||
    !Object.hasOwn(meta, "err") ||
    !Array.isArray(wire) ||
    wire[1] !== "base64" ||
    typeof wire[0] !== "string" ||
    wire[0].length > 6000
  )
    throw new Error("Incomplete receipt.");
  const bytes = getBase64Encoder().encode(wire[0]);
  if (bytes.length > 4096) throw new Error("Oversized receipt.");
  const tx = getTransactionDecoder().decode(bytes);
  const message = getCompiledTransactionMessageDecoder().decode(
    tx.messageBytes,
  );
  const signature =
    tx.signatures[expected.wallet as keyof typeof tx.signatures];
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(tx.messageBytes)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (
    message.staticAccounts[0] !== expected.wallet ||
    Object.keys(tx.signatures).length !== 1 ||
    !signature ||
    signature.length !== 64 ||
    getBase58Decoder().decode(signature) !== expected.signature ||
    digest !== expected.messageHash ||
    (meta.err !== null &&
      typeof meta.err !== "object" &&
      typeof meta.err !== "string")
  )
    throw new Error("Receipt binding mismatch.");
  return {
    outcome: meta.err === null ? "confirmed" : "chain_failed",
    receiptHash: await reconciliationHash({
      slot: receipt.slot,
      messageHash: digest,
      signature: expected.signature,
      failed: meta.err !== null,
    }),
  };
}
