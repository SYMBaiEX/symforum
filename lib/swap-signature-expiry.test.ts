import { expect, test } from "vitest";
import {
  requireSignatureExpiry,
  signatureStatus,
} from "./swap-signature-expiry";
import { MAINNET_GENESIS } from "./swap-reconciliation";
const row = {
  wallet: "wallet",
  status: "submitted",
  signature: "signature",
  createdAt: 1,
  expiresAt: 2,
  simulationSlot: 200,
  lastValidBlockHeight: 100,
};
const proof = {
  signature: "signature",
  checkedAt: 1000,
  genesis: MAINNET_GENESIS,
  statusSlot: 301,
  invalidAtSlot: 300,
  finalizedHeight: 133,
  firstAvailableSlot: 1,
};
test("new signature-first expiry is based on chain height, never wall-clock wait alone", () => {
  expect(() => requireSignatureExpiry(row, proof, 1001)).not.toThrow();
});
test.each([
  { signature: "other" },
  { finalizedHeight: 132 },
  { statusSlot: 299 },
  { invalidAtSlot: 200 },
  { firstAvailableSlot: 201 },
  { checkedAt: 1002 },
  { genesis: "other" },
  { finalizedHeight: NaN },
])("incomplete signed proof %j remains unknown", (change) => {
  expect(() =>
    requireSignatureExpiry(row, { ...proof, ...change }, 1001),
  ).toThrow();
});
test("stale proofs are rejected", () => {
  expect(() => requireSignatureExpiry(row, proof, 62000)).toThrow();
});
test.each([
  { simulationSlot: undefined },
  { lastValidBlockHeight: undefined },
  { simulationSlot: NaN },
])(
  "missing immutable lifetime metadata cannot authorize expiry %j",
  (change) => {
    expect(() =>
      requireSignatureExpiry({ ...row, ...change }, proof, 1001),
    ).toThrow();
  },
);
test("signature status requires fresh context and one explicit entry", () => {
  expect(
    signatureStatus({ context: { slot: 300 }, value: [null] }, 200),
  ).toEqual({ slot: 300, missing: true, progress: null });
  expect(
    signatureStatus(
      {
        context: { slot: 300 },
        value: [{ slot: 250, err: null, confirmationStatus: "confirmed" }],
      },
      200,
    ).progress,
  ).toBe("confirmed");
  for (const response of [
    { context: { slot: 199 }, value: [null] },
    { context: { slot: 300 }, value: [] },
    {
      context: { slot: 300 },
      value: [{ slot: 301, err: null, confirmationStatus: "confirmed" }],
    },
    {
      context: { slot: 300 },
      value: [{ slot: 250, confirmationStatus: "finalized" }],
    },
  ])
    expect(() => signatureStatus(response, 200)).toThrow();
});
