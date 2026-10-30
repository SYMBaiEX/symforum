import { expect, test } from "vitest";
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
import { inspectSwapReceipt } from "./swap-receipt";

async function fixture(version: 0 | 1 = 1) {
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
  const signature = getBase58Decoder().decode(new Uint8Array(64).fill(1));
  const messageHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(tx.messageBytes)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const wire = getBase64EncodedWireTransaction({
    ...tx,
    signatures: { [wallet]: new Uint8Array(64).fill(1) },
  } as unknown as Parameters<typeof getBase64EncodedWireTransaction>[0]);
  return {
    expected: { wallet, signature, messageHash, simulationSlot: 200 },
    receipt: {
      slot: 250,
      meta: { err: null as unknown },
      transaction: [wire, "base64"],
    },
  };
}
test.each([0, 1] as const)(
  "version %s binds payer, signature and exact message",
  async (version) => {
    const f = await fixture(version);
    expect(await inspectSwapReceipt(f.receipt, f.expected)).toMatchObject({
      outcome: "confirmed",
      receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    f.receipt.meta.err = { InstructionError: [0, "fixture"] };
    expect(await inspectSwapReceipt(f.receipt, f.expected)).toMatchObject({
      outcome: "chain_failed",
    });
  },
);
test("missing receipt is unknown, never failed", async () => {
  const f = await fixture();
  expect(await inspectSwapReceipt(null, f.expected)).toBeNull();
});
test.each([
  { wallet: "11111111111111111111111111111111" },
  { signature: "1".repeat(88) },
  { messageHash: "0".repeat(64) },
  { simulationSlot: 251 },
])("rejects changed receipt binding %j", async (change) => {
  const f = await fixture();
  await expect(
    inspectSwapReceipt(f.receipt, { ...f.expected, ...change }),
  ).rejects.toThrow();
});
test.each([
  { slot: "250" },
  { meta: {} },
  { transaction: ["!invalid", "base64"] },
  { transaction: ["x".repeat(6001), "base64"] },
  { transaction: ["AA==", "json"] },
])("rejects incomplete receipt %j", async (change) => {
  const f = await fixture();
  await expect(
    inspectSwapReceipt({ ...f.receipt, ...change }, f.expected),
  ).rejects.toThrow();
});
