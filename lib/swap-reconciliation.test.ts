import { describe, expect, test } from "vitest";
import {
  address,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import {
  MAINNET_GENESIS,
  preparedBlockhash,
  proveQuietHistory,
  reconciliationHash,
  requireExpiredUnsignedHold,
  requireExpiryProof,
  type ExpiredSwap,
  type RpcExpiryProof,
} from "./swap-reconciliation";
export async function heldFixture(version: 0 | 1 = 1) {
  const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
  const tx = compileTransaction(
    setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: blockhash("11111111111111111111111111111111"),
        lastValidBlockHeight: 100n,
      },
      setTransactionMessageFeePayer(
        address(wallet),
        createTransactionMessage({ version }),
      ),
    ),
  );
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(tx.messageBytes)),
  );
  return {
    wallet,
    status: "held",
    issue: "wallet_outcome_unknown",
    createdAt: Date.now() - 3_600_000,
    expiresAt: Date.now() - 3_575_000,
    transactionBase64: getBase64EncodedWireTransaction(tx),
    messageHash: Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    simulationSlot: 200,
    lastValidBlockHeight: 100,
    transactionVersion: version,
  };
}
export function historyFixture(row: ExpiredSwap) {
  return [
    {
      signature: getBase58Decoder().decode(new Uint8Array(64).fill(1)),
      slot: 190,
      blockTime: Math.floor(row.createdAt / 1000) - 180,
      confirmationStatus: "finalized",
      err: null,
    },
  ];
}
export async function proofFixture(row: ExpiredSwap): Promise<RpcExpiryProof> {
  return {
    checkedAt: Date.now(),
    genesis: MAINNET_GENESIS,
    invalidAtSlot: 300,
    finalizedHeight: 150,
    firstAvailableSlot: 1,
    ...(await proveQuietHistory(historyFixture(row), row)),
  };
}
describe("expired unsigned hold proof", () => {
  test.each([0, 1] as const)(
    "binds the saved unsigned version %s message",
    async (version) => {
      const row = await heldFixture(version);
      expect(requireExpiredUnsignedHold(row, Date.now())).toBeUndefined();
      expect(await preparedBlockhash(row)).toBe(
        "11111111111111111111111111111111",
      );
      expect(
        requireExpiryProof(row, await proofFixture(row), Date.now()),
      ).toBeUndefined();
    },
  );
  test.each([
    { signature: "known" },
    { status: "confirmed" },
    { status: "submitted" },
    { issue: "another_hold" },
    { expiresAt: Date.now() - 60_000 },
    { simulationSlot: 0 },
  ])("does not release an ineligible hold %j", async (change) => {
    const row = await heldFixture();
    expect(() =>
      requireExpiredUnsignedHold({ ...row, ...change }, Date.now()),
    ).toThrow();
  });
  test.each([
    { messageHash: "0".repeat(64) },
    { wallet: "11111111111111111111111111111111" },
    { transactionVersion: 0 },
  ])("rejects changed wire binding %j", async (change) => {
    await expect(
      preparedBlockhash({ ...(await heldFixture()), ...change }),
    ).rejects.toThrow();
  });
  test.each([
    { blockTime: null },
    { confirmationStatus: "confirmed" },
    { slot: 200 },
    { signature: "invalid" },
    { blockTime: "1" },
  ])("requires complete finalized history %j", async (change) => {
    const row = await heldFixture();
    await expect(
      proveQuietHistory([{ ...historyFixture(row)[0], ...change }], row),
    ).rejects.toThrow();
  });
  test("empty, truncated, duplicate and active approval-window histories are inconclusive", async () => {
    const row = await heldFixture(),
      history = historyFixture(row);
    await expect(proveQuietHistory([], row)).rejects.toThrow();
    await expect(
      proveQuietHistory(Array(11).fill(history[0]), row),
    ).rejects.toThrow();
    await expect(
      proveQuietHistory([history[0], history[0]], row),
    ).rejects.toThrow();
    await expect(
      proveQuietHistory(
        [{ ...history[0], blockTime: Math.floor(row.createdAt / 1000) }],
        row,
      ),
    ).rejects.toThrow();
  });
  test.each([
    { genesis: "wrong-chain" },
    { invalidAtSlot: 199 },
    { finalizedHeight: 132 },
    { firstAvailableSlot: 201 },
    { checkedAt: Date.now() - 120000 },
    { checkedAt: Date.now() + 120000 },
    { historyCount: 0 },
    { historyHash: "wrong" },
  ])("rejects inadequate expiry proof %j", async (change) => {
    const row = await heldFixture(),
      proof = await proofFixture(row);
    expect(() =>
      requireExpiryProof(row, { ...proof, ...change }, Date.now()),
    ).toThrow();
  });
  test("snapshot hash is key-order stable and detects modifications", async () => {
    expect(await reconciliationHash({ a: 1, b: 2 })).toBe(
      await reconciliationHash({ b: 2, a: 1 }),
    );
    expect(await reconciliationHash({ a: 1 })).not.toBe(
      await reconciliationHash({ a: 2 }),
    );
  });
});
