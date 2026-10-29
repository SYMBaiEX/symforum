import { test, expect, vi } from "vitest";
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
import {
  verifyPreparedTransaction,
  requestReviewedTransaction,
  type CommerceWalletClient,
} from "./commerce-wallet-client";
const boundary = vi.hoisted(() => ({
  getFeature: vi.fn(),
  getAccount: vi.fn(),
}));
vi.mock("@wallet-standard/ui-features", () => ({
  getWalletAccountFeature: boundary.getFeature,
}));
vi.mock("@wallet-standard/ui-registry", () => ({
  getWalletAccountForUiWalletAccount: boundary.getAccount,
}));
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
test("wallet preflight uses the simulated commitment and slot, without RPC retries", async () => {
  const prepared = fixture();
  const account = { address: prepared.wallet, chains: ["solana:mainnet"] };
  boundary.getAccount.mockReturnValue(account);
  const call = vi.fn(async (_input: unknown) => [
    { signature: new Uint8Array(64).fill(1) },
  ]);
  boundary.getFeature.mockReturnValue({ signAndSendTransaction: call });
  const client = {
    wallet: {
      getState: () => ({
        connected: { account, supportedTransactionVersions: new Set([0]) },
      }),
    },
  } as unknown as CommerceWalletClient;
  await requestReviewedTransaction(client, prepared);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]?.[0]).toMatchObject({
    account,
    chain: "solana:mainnet",
    options: {
      preflightCommitment: "confirmed",
      commitment: "confirmed",
      minContextSlot: prepared.simulationSlot,
      skipPreflight: false,
      maxRetries: 0,
    },
  });
  call.mockRejectedValueOnce(new Error("Ambiguous wallet outcome"));
  await expect(requestReviewedTransaction(client, prepared)).rejects.toThrow(
    "Ambiguous wallet outcome",
  );
  expect(call).toHaveBeenCalledTimes(2);
});
