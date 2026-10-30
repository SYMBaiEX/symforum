import { address } from "@solana/kit";
import {
  MAX_PRICE_IMPACT_BPS,
  SWAP_QUOTE_TTL_MS,
  providerJson,
  rawAmount,
  record,
  validateSwapRequest,
  type SwapRequest,
  type SwapRouteQuote,
} from "./swap-router";

export const JUPITER_SWAP_API = "https://api.jup.ag/swap/v2";
export const JUPITER_REFERRAL_PROGRAM =
  "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";
export const JUPITER_REFERRAL_PROJECT =
  "DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc";
export type ManagedFees = {
  feeMint: string;
  totalFeeBps: number;
  integratorFeeBps: number;
  jupiterFeeBps: number;
};
export type ManagedConfig = {
  jupiterApiKey?: string;
  referralAccount?: string;
};

function requireValue(value: unknown): asserts value {
  if (!value)
    throw new Error("Jupiter order did not match the requested swap.");
}
function integer(value: unknown, max: number) {
  requireValue(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= max,
  );
  return value;
}
/** Only independently simulatable, sole-payer Metis orders are admitted. RFQ
 * maker signatures/gasless payers require a different receipt policy. */
export function managedOrderUrl(request: SwapRequest, config: ManagedConfig) {
  validateSwapRequest(request);
  requireValue(config.jupiterApiKey);
  requireValue(request.platformFeeBps === 0 || request.platformFeeBps === 50);
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amountRaw,
    taker: request.wallet,
    slippageBps: String(request.slippageBps),
    maxSupportedTransactionVersion: request.supportsV1 ? "1" : "0",
    excludeRouters: "jupiterz,dflow,okx",
  });
  if (request.platformFeeBps) {
    requireValue(config.referralAccount);
    address(config.referralAccount);
    params.set("referralAccount", config.referralAccount);
    params.set("referralFee", "50");
  }
  return `${JUPITER_SWAP_API}/order?${params}`;
}
export function normalizeManagedOrder(
  value: unknown,
  request: SwapRequest,
  config: ManagedConfig,
  now = Date.now(),
): SwapRouteQuote {
  validateSwapRequest(request);
  const order = record(value);
  const platform = record(order.platformFee);
  requireValue(
    order.router === "metis" &&
      order.gasless === false &&
      !order.error &&
      !order.errorCode,
  );
  requireValue(
    order.inputMint === request.inputMint &&
      order.outputMint === request.outputMint &&
      order.taker === request.wallet &&
      order.swapMode === "ExactIn" &&
      rawAmount(order.inAmount) === BigInt(request.amountRaw) &&
      order.slippageBps === request.slippageBps,
  );
  const out = rawAmount(order.outAmount),
    minimum = rawAmount(order.otherAmountThreshold);
  requireValue(
    minimum <= out &&
      minimum >= (out * BigInt(10_000 - request.slippageBps)) / 10_000n,
  );
  const impact = Number(order.priceImpactPct);
  requireValue(
    typeof order.priceImpactPct === "string" &&
      Number.isFinite(impact) &&
      Math.abs(impact) * 100 <= MAX_PRICE_IMPACT_BPS,
  );
  const feeBps = integer(order.feeBps, 100);
  requireValue(
    integer(platform.feeBps, 100) === feeBps &&
      platform.feeMint === order.feeMint &&
      [request.inputMint, request.outputMint].includes(String(order.feeMint)),
  );
  if (request.platformFeeBps) {
    requireValue(
      request.platformFeeBps === 50 &&
        feeBps === 50 &&
        config.referralAccount &&
        order.referralAccount === config.referralAccount,
    );
  } else {
    requireValue(!order.referralAccount && feeBps <= 50);
  }
  for (const key of [
    "signatureFeePayer",
    "prioritizationFeePayer",
    "rentFeePayer",
  ])
    requireValue(!order[key] || order[key] === request.wallet);
  const networkFee =
    integer(order.signatureFeeLamports, 1_000_000) +
    integer(order.prioritizationFeeLamports, 1_000_000);
  requireValue(networkFee <= 1_000_000);
  integer(order.rentFeeLamports, 10_000_000);
  requireValue(
    typeof order.transaction === "string" &&
      order.transaction.length > 0 &&
      order.transaction.length <= 6000 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(order.transaction),
  );
  requireValue(
    (order.transactionVersion === 0 || order.transactionVersion === 1) &&
      (order.transactionVersion !== 1 || request.supportsV1),
  );
  requireValue(
    typeof order.requestId === "string" &&
      /^[A-Za-z0-9_-]{1,150}$/.test(order.requestId),
  );
  requireValue(
    typeof order.lastValidBlockHeight === "string" &&
      /^\d{1,16}$/.test(order.lastValidBlockHeight) &&
      Number.isSafeInteger(Number(order.lastValidBlockHeight)) &&
      Number(order.lastValidBlockHeight) > 0,
  );
  const expiry =
    order.expireAt === undefined
      ? now + SWAP_QUOTE_TTL_MS
      : Date.parse(String(order.expireAt));
  requireValue(Number.isFinite(expiry) && expiry > now);
  const fees: ManagedFees = {
    feeMint: String(order.feeMint),
    totalFeeBps: feeBps,
    integratorFeeBps: request.platformFeeBps,
    jupiterFeeBps: request.platformFeeBps ? 0 : feeBps,
  };
  return {
    id: crypto.randomUUID(),
    provider: "jupiter",
    execution: "jupiter-managed",
    request,
    // Jupiter collects the fee inside its transaction, never an appended transfer.
    swapAmountRaw: request.amountRaw,
    platformFeeRaw:
      request.platformFeeBps && fees.feeMint === request.inputMint
        ? String(
            (BigInt(request.amountRaw) * BigInt(request.platformFeeBps)) /
              10_000n,
          )
        : "0",
    outputAmountRaw: String(out),
    minimumOutputAmountRaw: String(minimum),
    priceImpactBps: Math.round(Math.abs(impact) * 100),
    createdAt: now,
    expiresAt: Math.min(expiry, now + SWAP_QUOTE_TTL_MS),
    routeLabels: ["Jupiter managed · Metis"],
    fees,
    opaque: order,
  };
}
export async function getManagedOrder(
  request: SwapRequest,
  config: ManagedConfig,
  fetcher: typeof fetch = fetch,
) {
  const order = await providerJson(managedOrderUrl(request, config), fetcher, {
    headers: { "x-api-key": config.jupiterApiKey! },
  });
  return normalizeManagedOrder(order, request, config);
}
/** One execute request, no automatic HTTP retries. Only the saved order ID is
 * accepted; no caller-controlled URL or provider payload crosses this boundary. */
export async function executeManagedOrder(
  requestId: string,
  signedTransaction: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
) {
  const result = await providerJson(
    `${JUPITER_SWAP_API}/execute`,
    fetcher,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ requestId, signedTransaction }),
    },
    30_000,
  );
  return {
    status: result.status,
    signature: result.signature,
    code: result.code,
  };
}
