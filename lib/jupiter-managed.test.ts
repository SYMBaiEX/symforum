import { afterEach, expect, test, vi } from "vitest";
import {
  managedOrderUrl,
  normalizeManagedOrder,
  executeManagedOrder,
} from "./jupiter-managed";
import { SOL_MINT, USDC_MINT, type SwapRequest } from "./swap-router";
afterEach(() => vi.unstubAllGlobals());
const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
const config = { jupiterApiKey: "fixture-not-a-key", referralAccount: wallet };
const request: SwapRequest = {
  wallet,
  inputMint: SOL_MINT,
  outputMint: USDC_MINT,
  amountRaw: "10000000",
  slippageBps: 50,
  platformFeeBps: 50,
  supportsV1: false,
};
export function managedFixture() {
  return {
    router: "metis",
    gasless: false,
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    taker: wallet,
    swapMode: "ExactIn",
    inAmount: "10000000",
    outAmount: "990000",
    otherAmountThreshold: "985050",
    slippageBps: 50,
    priceImpactPct: "0.01",
    feeBps: 50,
    feeMint: SOL_MINT,
    platformFee: { feeBps: 50, feeMint: SOL_MINT },
    referralAccount: wallet,
    signatureFeeLamports: 5000,
    prioritizationFeeLamports: 10000,
    rentFeeLamports: 2000000,
    transaction: "AQAAAA==",
    transactionVersion: 0,
    requestId: "saved-server-order-1",
    lastValidBlockHeight: "400000001",
  };
}
test("managed order uses the full input and referral without a second fee transfer", () => {
  const url = new URL(managedOrderUrl(request, config));
  expect(url.pathname).toBe("/swap/v2/order");
  expect(url.searchParams.get("amount")).toBe(request.amountRaw);
  expect(url.searchParams.get("referralFee")).toBe("50");
  expect(url.searchParams.get("maxSupportedTransactionVersion")).toBe("0");
  expect(url.searchParams.get("excludeRouters")).toBe("jupiterz,dflow,okx");
  const q = normalizeManagedOrder(managedFixture(), request, config, 1000);
  expect(q).toMatchObject({
    execution: "jupiter-managed",
    swapAmountRaw: request.amountRaw,
    platformFeeRaw: "50000",
    expiresAt: 26000,
    fees: { totalFeeBps: 50, integratorFeeBps: 50, jupiterFeeBps: 0 },
  });
});
test("historical no-referral order discloses Jupiter's own fee (not offered by new quotes)", () => {
  const waived = { ...request, platformFeeBps: 0 };
  expect(
    new URL(managedOrderUrl(waived, config)).searchParams.has(
      "referralAccount",
    ),
  ).toBe(false);
  const q = normalizeManagedOrder(
    {
      ...managedFixture(),
      referralAccount: undefined,
      feeBps: 10,
      platformFee: { feeBps: 10, feeMint: SOL_MINT },
    },
    waived,
    config,
  );
  expect(q.fees).toEqual({
    feeMint: SOL_MINT,
    integratorFeeBps: 0,
    totalFeeBps: 10,
    jupiterFeeBps: 10,
  });
  expect(q.platformFeeRaw).toBe("0");
});
test.each([
  { router: "jupiterz" },
  { gasless: true },
  { taker: USDC_MINT },
  { inAmount: "9950000" },
  { inputMint: USDC_MINT },
  { outAmount: "0" },
  { otherAmountThreshold: "1" },
  { slippageBps: 500 },
  { priceImpactPct: "5.01" },
  { feeBps: 100 },
  { referralAccount: USDC_MINT },
  { referralAccount: undefined },
  { errorCode: 1 },
  { transaction: "" },
  { transactionVersion: 1 },
  { requestId: "unsafe/id" },
  { lastValidBlockHeight: "not-a-height" },
  { signatureFeePayer: USDC_MINT },
  { prioritizationFeeLamports: 1000000 },
  { expireAt: "2000-01-01" },
])("fails closed on incorrect order fields %j", (change) => {
  expect(() =>
    normalizeManagedOrder({ ...managedFixture(), ...change }, request, config),
  ).toThrow();
});
test("missing referral/key or unsupported integrator fee cannot silently fall back", () => {
  expect(() => managedOrderUrl(request, {})).toThrow();
  expect(() =>
    managedOrderUrl(request, { jupiterApiKey: "fixture" }),
  ).toThrow();
  expect(() =>
    managedOrderUrl({ ...request, platformFeeBps: 25 }, config),
  ).toThrow();
});
test("price impact ratio and percentage units both enforce the unchanged five-percent cap", () => {
  expect(() =>
    normalizeManagedOrder(
      { ...managedFixture(), priceImpactPct: "0.0501" },
      request,
      config,
    ),
  ).toThrow();
  expect(() =>
    normalizeManagedOrder(
      { ...managedFixture(), priceImpact: -5.01, priceImpactPct: "0" },
      request,
      config,
    ),
  ).toThrow();
  expect(
    normalizeManagedOrder(
      { ...managedFixture(), priceImpact: -1.25, expireAt: null },
      request,
      config,
    ).priceImpactBps,
  ).toBe(125);
});
test("execute sends only saved request and signed bytes to the fixed endpoint once", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      status: "Success",
      code: 0,
      signature: "public-signature",
    }),
  );
  expect(
    await executeManagedOrder(
      "saved-request",
      "signed-fixture",
      "test-key",
      fetcher,
    ),
  ).toEqual({ status: "Success", code: 0, signature: "public-signature" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.jup.ag/swap/v2/execute",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        requestId: "saved-request",
        signedTransaction: "signed-fixture",
      }),
      redirect: "error",
    }),
  );
  fetcher.mockRejectedValueOnce(new Error("ambiguous timeout"));
  await expect(
    executeManagedOrder("saved-request", "signed-fixture", "test-key", fetcher),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2); // One call per explicit invocation, no retry loop.
});
