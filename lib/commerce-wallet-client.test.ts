import { test, expect } from "vitest";
import {
  address,
  blockhash,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  compileTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { createHash } from "node:crypto";
import { verifyPreparedTransaction } from "./commerce-wallet-client";
function fixture() {
  const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
  const tx = compileTransaction(
    setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: blockhash("11111111111111111111111111111111"),
        lastValidBlockHeight: 99999n,
      },
      setTransactionMessageFeePayer(
        address(wallet),
        createTransactionMessage({ version: 0 }),
      ),
    ),
  );
  return {
    wallet,
    transactionBase64: getBase64EncodedWireTransaction(tx),
    transactionVersion: 0 as const,
    lastValidBlockHeight: 99999,
    simulationSlot: 1,
    estimatedNetworkFeeLamports: "5000",
    messageHash: createHash("sha256")
      .update(Uint8Array.from(tx.messageBytes))
      .digest("hex"),
  };
}
test("only exact unsigned simulated message enables the wallet review", async () => {
  const value = fixture();
  expect(await verifyPreparedTransaction(value)).toEqual(value);
  expect(Object.isFrozen(await verifyPreparedTransaction(value))).toBe(true);
});
test.each([
  { messageHash: "0".repeat(64) },
  { wallet: "11111111111111111111111111111111" },
  { transactionVersion: 1 as const },
])("rejects changed review binding %j", async (change) => {
  await expect(
    verifyPreparedTransaction({ ...fixture(), ...change }),
  ).rejects.toThrow(/does not match/);
});
