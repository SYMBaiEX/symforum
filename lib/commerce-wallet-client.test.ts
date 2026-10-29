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
import { runInNewContext } from "node:vm";
import {
  verifyPreparedTransaction,
  requestReviewedTransaction,
  CommerceWalletRequestError,
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
    "Wallet outcome requires verification",
  );
  expect(call).toHaveBeenCalledTimes(2);
});

function requestWithResponse(response: unknown) {
  const prepared = fixture();
  const account = { address: prepared.wallet, chains: ["solana:mainnet"] };
  boundary.getAccount.mockReturnValue(account);
  const call = vi.fn(async () => response);
  boundary.getFeature.mockReturnValue({ signAndSendTransaction: call });
  const client = {
    wallet: {
      getState: () => ({
        connected: {
          account,
          supportedTransactionVersions: new Set([0]),
        },
      }),
    },
  } as unknown as CommerceWalletClient;
  return { call, request: () => requestReviewedTransaction(client, prepared) };
}

test("accepts exact 64-byte Uint8Array signatures from an extension realm", async () => {
  const signature = runInNewContext("new Uint8Array(64).fill(1)");
  expect(signature instanceof Uint8Array).toBe(false);
  const { call, request } = requestWithResponse([{ signature }]);
  expect(await request()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  expect(call).toHaveBeenCalledTimes(1);
});

test.each([undefined, null, {}, [], [{}, {}]])(
  "malformed result %j remains uncertain, with no second wallet call",
  async (response) => {
    const { call, request } = requestWithResponse(response);
    await expect(request()).rejects.toMatchObject({
      phase: "response",
      responseIssue: "result_count",
    });
    expect(call).toHaveBeenCalledTimes(1);
  },
);
test.each([
  undefined,
  "secret-provider-body",
  Array(64).fill(1),
  new Uint8Array(63),
  new Uint16Array(32),
  new DataView(new ArrayBuffer(64)),
  new Uint8ClampedArray(64),
])("invalid signature %j is not accepted or resent", async (signature) => {
  const { call, request } = requestWithResponse([{ signature }]);
  await expect(request()).rejects.toMatchObject({
    phase: "response",
    responseIssue: "signature_bytes",
  });
  expect(call).toHaveBeenCalledTimes(1);
});
test("wallet rejection preserves only its numeric code and phase, not the provider body", async () => {
  const { call, request } = requestWithResponse([]);
  call.mockRejectedValueOnce({
    code: -32002,
    message: "private provider body",
    data: { token: "secret" },
  });
  try {
    await request();
    throw new Error("Expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(CommerceWalletRequestError);
    expect(error).toMatchObject({ phase: "request", code: -32002 });
    expect(JSON.stringify(error)).not.toMatch(/private|secret|token/);
    expect(String(error)).not.toContain("private provider body");
  }
  expect(call).toHaveBeenCalledTimes(1);
});
