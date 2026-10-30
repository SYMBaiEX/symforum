import { MAINNET_GENESIS } from "./swap-reconciliation";
import type { ExpiredSwap } from "./swap-reconciliation";
import { record } from "./swap-router";
export type SignatureExpiryProof = {
  signature: string;
  checkedAt: number;
  genesis: string;
  statusSlot: number;
  invalidAtSlot: number;
  finalizedHeight: number;
  firstAvailableSlot: number;
};
export function requireSignatureExpiry(
  row: ExpiredSwap,
  proof: SignatureExpiryProof,
  now: number,
) {
  const nums = [
    proof.checkedAt,
    proof.statusSlot,
    proof.invalidAtSlot,
    proof.finalizedHeight,
    proof.firstAvailableSlot,
  ];
  if (
    !row.signature ||
    !Number.isSafeInteger(row.simulationSlot) ||
    Number(row.simulationSlot) <= 0 ||
    !Number.isSafeInteger(row.lastValidBlockHeight) ||
    Number(row.lastValidBlockHeight) <= 0 ||
    proof.signature !== row.signature ||
    nums.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    proof.genesis !== MAINNET_GENESIS ||
    proof.checkedAt > now ||
    now - proof.checkedAt > 60000 ||
    proof.invalidAtSlot <= Number(row.simulationSlot) ||
    proof.statusSlot < proof.invalidAtSlot ||
    proof.finalizedHeight <= Number(row.lastValidBlockHeight) + 32 ||
    proof.firstAvailableSlot > Number(row.simulationSlot)
  )
    throw Error("Signature expiry proof incomplete.");
}
export function signatureStatus(value: unknown, simulationSlot: number) {
  const result = record(value),
    context = record(result.context);
  if (
    !Number.isSafeInteger(context.slot) ||
    Number(context.slot) < simulationSlot ||
    !Array.isArray(result.value) ||
    result.value.length !== 1
  )
    throw Error("Signature status coverage incomplete.");
  const status = result.value[0];
  if (status === null)
    return { slot: Number(context.slot), missing: true, progress: null };
  const entry = record(status);
  if (
    !Number.isSafeInteger(entry.slot) ||
    Number(entry.slot) < simulationSlot ||
    Number(entry.slot) > Number(context.slot) ||
    !Object.hasOwn(entry, "err") ||
    !["processed", "confirmed", "finalized"].includes(
      String(entry.confirmationStatus),
    )
  )
    throw Error("Signature status coverage incomplete.");
  return {
    slot: Number(context.slot),
    missing: false,
    progress:
      entry.err === null
        ? (entry.confirmationStatus as "processed" | "confirmed" | "finalized")
        : null,
  };
}
