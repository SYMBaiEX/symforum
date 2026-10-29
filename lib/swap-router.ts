import { address } from "@solana/kit";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SWAP_QUOTE_TTL_MS = 25_000;
export const MAX_PRICE_IMPACT_BPS = 500;
export type SwapProvider = "jupiter" | "raydium";
export type SwapRequest = {
  wallet: string;
  inputMint: string;
  outputMint: string;
  /** Total debit excluding network fees/rent; platform fee is included. */
  amountRaw: string;
  slippageBps: number;
  platformFeeBps: number;
  supportsV1: boolean;
};
export type SwapRouterConfig = {
  rpcUrl: string;
  jupiterApiKey?: string;
  treasury: string | null;
};
export type SwapRouteQuote = {
  id: string;
  provider: SwapProvider;
  request: SwapRequest;
  swapAmountRaw: string;
  platformFeeRaw: string;
  outputAmountRaw: string;
  minimumOutputAmountRaw: string;
  priceImpactBps: number;
  createdAt: number;
  expiresAt: number;
  routeLabels: string[];
  /** Server-only provider data. Never accept this back from a browser. */
  opaque: Record<string, unknown>;
};
export type PreparedSwap = {
  transactionBase64: string;
  transactionVersion: 0 | 1;
  lastValidBlockHeight: number;
  simulationSlot: number;
  estimatedNetworkFeeLamports: string;
  messageHash: string;
};
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid provider response.");
  return value as Record<string, unknown>;
}
export function rawAmount(value: unknown, allowZero = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value))
    throw new Error("Invalid token amount.");
  const n = BigInt(value);
  if ((!allowZero && n === 0n) || n > 18_446_744_073_709_551_615n)
    throw new Error("Token amount is out of range.");
  return n;
}
export function validateSwapRequest(request: SwapRequest) {
  address(request.wallet);
  address(request.inputMint);
  address(request.outputMint);
  if (request.inputMint === request.outputMint)
    throw new Error("Choose two different tokens.");
  if (
    !Number.isInteger(request.slippageBps) ||
    request.slippageBps < 1 ||
    request.slippageBps > 500
  )
    throw new Error("Slippage must be between 0.01% and 5%.");
  if (
    !Number.isInteger(request.platformFeeBps) ||
    request.platformFeeBps < 0 ||
    request.platformFeeBps > 100
  )
    throw new Error("Platform fee configuration is invalid.");
  const total = rawAmount(request.amountRaw);
  const fee = (total * BigInt(request.platformFeeBps)) / 10_000n;
  if (total <= fee) throw new Error("Swap amount is too small.");
  return { total, fee, swap: total - fee };
}
export async function providerJson(
  url: string,
  fetcher: typeof fetch = fetch,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetcher(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Provider rate limit reached."
        : "Provider unavailable.",
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty provider response.");
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 300_000) throw new Error("Provider response is too large.");
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return record(JSON.parse(text));
}
function normalize(
  provider: SwapProvider,
  request: SwapRequest,
  payload: Record<string, unknown>,
): SwapRouteQuote {
  const { fee, swap } = validateSwapRequest(request);
  const quote = provider === "raydium" ? record(payload.data) : payload;
  if (
    quote.inputMint !== request.inputMint ||
    quote.outputMint !== request.outputMint ||
    rawAmount(provider === "raydium" ? quote.inputAmount : quote.inAmount) !==
      swap ||
    quote.slippageBps !== request.slippageBps
  )
    throw new Error("Provider quote does not match the request.");
  if (
    provider === "raydium" &&
    (payload.success !== true ||
      quote.swapType !== "BaseIn" ||
      rawAmount(quote.referrerAmount ?? "0", true) !== 0n)
  )
    throw new Error("Unexpected Raydium fee or quote mode.");
  if (provider === "jupiter" && quote.swapMode !== "ExactIn")
    throw new Error("Only exact-input swaps are supported.");
  const out = rawAmount(
    provider === "raydium" ? quote.outputAmount : quote.outAmount,
  );
  const minimum = rawAmount(quote.otherAmountThreshold);
  const floor = (out * BigInt(10_000 - request.slippageBps)) / 10_000n;
  // Advertise only the conservative amount enforced by the on-chain slippage arguments.
  if (minimum > floor + 1n || minimum < floor || floor === 0n)
    throw new Error("Provider widened slippage.");
  const impact = Number(quote.priceImpactPct);
  // Jupiter's field is a fractional ratio; Raydium's field is percentage points.
  const impactBps = impact * (provider === "jupiter" ? 10_000 : 100);
  if (
    !Number.isFinite(impact) ||
    impact < 0 ||
    impactBps > MAX_PRICE_IMPACT_BPS
  )
    throw new Error("Price impact exceeds the safety limit.");
  if (
    !Array.isArray(quote.routePlan) ||
    !quote.routePlan.length ||
    quote.routePlan.length > 12
  )
    throw new Error("Invalid route plan.");
  const routeLabels = quote.routePlan.map((item) => {
    const route = record(item);
    const info = provider === "jupiter" ? record(route.swapInfo) : route;
    address(String(provider === "jupiter" ? info.ammKey : info.poolId));
    return provider === "jupiter" && typeof info.label === "string"
      ? info.label.replace(/[<>\n\r]/g, "").slice(0, 40)
      : "Raydium";
  });
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    provider,
    request: { ...request },
    swapAmountRaw: swap.toString(),
    platformFeeRaw: fee.toString(),
    outputAmountRaw: out.toString(),
    minimumOutputAmountRaw: floor.toString(),
    priceImpactBps: Math.ceil(impactBps),
    createdAt: now,
    expiresAt: now + SWAP_QUOTE_TTL_MS,
    routeLabels: [...new Set(routeLabels)],
    opaque: payload,
  };
}
/** Best quoted output among responding sources, not a claim about every Solana venue. */
export async function collectSwapQuotes(
  request: SwapRequest,
  config: SwapRouterConfig,
  fetcher: typeof fetch = fetch,
) {
  const { swap, fee } = validateSwapRequest(request);
  if (fee > 0n && !config.treasury)
    throw new Error("Platform treasury is not configured.");
  if (config.treasury) address(config.treasury);
  const common = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: swap.toString(),
    slippageBps: String(request.slippageBps),
  });
  const jobs: {
    provider: SwapProvider;
    load: () => Promise<Record<string, unknown>>;
  }[] = [
    {
      provider: "raydium",
      load: () =>
        providerJson(
          `https://transaction-v1.raydium.io/compute/swap-base-in?${common}&txVersion=V0`,
          fetcher,
        ),
    },
  ];
  jobs.push({
    provider: "jupiter",
    load: () =>
      providerJson(
        `https://api.jup.ag/swap/v2/build?${common}&taker=${request.wallet}&transactionVersion=${request.supportsV1 ? 1 : 0}&maxAccounts=64`,
        fetcher,
        config.jupiterApiKey
          ? { headers: { "x-api-key": config.jupiterApiKey } }
          : {},
      ),
  });
  const results = await Promise.all(
    jobs.map(async ({ provider, load }) => {
      try {
        return { quote: normalize(provider, request, await load()) };
      } catch {
        return {
          failure: {
            provider,
            reason: "No safe, fresh route available from this source.",
          },
        };
      }
    }),
  );
  const quotes = results
    .flatMap((r) => (r.quote ? [r.quote] : []))
    .sort((a, b) => {
      const delta = BigInt(b.outputAmountRaw) - BigInt(a.outputAmountRaw);
      return delta > 0n
        ? 1
        : delta < 0n
          ? -1
          : a.priceImpactBps - b.priceImpactBps;
    });
  return {
    quotes,
    failures: results.flatMap((r) => (r.failure ? [r.failure] : [])),
  };
}

export { buildSwapTransaction } from "./swap-transactions";
