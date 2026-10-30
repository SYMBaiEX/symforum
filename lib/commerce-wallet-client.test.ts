import { test, expect, vi } from "vitest";
import {
  address,
  blockhash,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
} from "@solana/kit";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import {
  verifyPreparedTransaction,
  requestReviewedTransaction,
  CommerceWalletRequestError,
  supportsCommerceTransaction,
  commerceWalletFailureMessage,
  signReviewedSwap,
  type CommerceWalletClient,
} from "./commerce-wallet-client";
import { signedSwapFixture } from "../tests/fixtures/signed-swap";
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
test("sign-only requests exactly the simulated transaction and never broadcasts or falls back", async () => {
  const f = await signedSwapFixture(1);
  const account = { address: f.wallet, chains: ["solana:mainnet"] };
  const sign = vi.fn(async () => [
    getTransactionDecoder().decode(
      getBase64Encoder().encode(f.signedTransactionBase64),
    ),
  ]);
  const send = vi.fn();
  boundary.getAccount.mockReturnValue(account);
  boundary.getFeature.mockImplementation((_account, feature) =>
    feature === "solana:signTransaction"
      ? { supportedTransactionVersions: [1], signTransaction: sign }
      : { supportedTransactionVersions: [0], signAndSendTransaction: send },
  );
  const client = {
    wallet: {
      getState: () => ({
        connected: {
          account,
          signer: { address: f.wallet, modifyAndSignTransactions: sign },
          supportedTransactionVersions: new Set([0]),
        },
      }),
    },
  } as unknown as CommerceWalletClient;
  expect(supportsCommerceTransaction(client, 1, true)).toBe(true);
  expect(supportsCommerceTransaction(client, 1, false)).toBe(false);
  expect(await signReviewedSwap(client, f.prepared)).toMatchObject({
    signedTransactionBase64: f.signedTransactionBase64,
  });
  expect(sign).toHaveBeenCalledTimes(1);
  expect(sign).toHaveBeenCalledWith([
    getTransactionDecoder().decode(
      getBase64Encoder().encode(f.prepared.transactionBase64),
    ),
  ]);
  expect(send).not.toHaveBeenCalled();
  await expect(
    signReviewedSwap(client, { ...f.prepared, messageHash: "0".repeat(64) }),
  ).rejects.toMatchObject({
    phase: "validation",
    responseIssue: "signed_binding",
    bindingIssue: "message_mismatch",
  });
  expect(send).not.toHaveBeenCalled();
  sign.mockRejectedValueOnce({
    code: -32603,
    message: "private signing error",
  });
  await expect(signReviewedSwap(client, f.prepared)).rejects.toMatchObject({
    phase: "request",
    code: -32603,
  });
  expect(send).not.toHaveBeenCalled();
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
  boundary.getFeature.mockReturnValue({
    signAndSendTransaction: call,
    supportedTransactionVersions: [0],
  });
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
  boundary.getFeature.mockReturnValue({
    signAndSendTransaction: call,
    supportedTransactionVersions: [0],
  });
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
test("checks the actual send feature, not the store's sign-only version set", async () => {
  const f = requestWithResponse([{ signature: new Uint8Array(64).fill(1) }]);
  const account = { address: fixture().wallet, chains: ["solana:mainnet"] };
  const client = {
    wallet: {
      getState: () => ({
        connected: { account, supportedTransactionVersions: new Set([0, 1]) },
      }),
    },
  } as unknown as CommerceWalletClient;
  expect(supportsCommerceTransaction(client, 0)).toBe(true);
  expect(supportsCommerceTransaction(client, 1)).toBe(false);
  await expect(
    requestReviewedTransaction(client, { ...fixture(), transactionVersion: 1 }),
  ).rejects.toMatchObject({ phase: "feature" });
  expect(f.call).not.toHaveBeenCalled();
});
test("send capability is authoritative even when a separate sign-only feature narrows the store", async () => {
  const f = requestWithResponse([{ signature: new Uint8Array(64).fill(1) }]);
  boundary.getFeature.mockReturnValue({
    supportedTransactionVersions: [0, 1],
    signAndSendTransaction: f.call,
  });
  const account = { address: fixture().wallet, chains: ["solana:mainnet"] };
  const client = {
    wallet: {
      getState: () => ({
        connected: { account, supportedTransactionVersions: new Set([0]) },
      }),
    },
  } as unknown as CommerceWalletClient;
  expect(supportsCommerceTransaction(client, 1)).toBe(true);
  await requestReviewedTransaction(client, {
    ...fixture(),
    transactionVersion: 1,
  });
  expect(f.call).toHaveBeenCalledTimes(1);
});
test.each([-32603, 4001, -32002, 999999])(
  "wallet code %s has a safe explanation but never claims non-submission",
  (code) => {
    const error = new CommerceWalletRequestError("request", {
      code,
      message: "private-payload",
    });
    expect(commerceWalletFailureMessage(error)).not.toMatch(
      /private-payload|nothing was sent/i,
    );
  },
);
