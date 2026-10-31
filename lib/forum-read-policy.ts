/**
 * Approved application ceilings, not a report of provider plan or remaining credit.
 * Callers must enforce provider-global admission before activating higher feature
 * caps. Constants alone do not meter I/O, authorize a payment, or permit retries.
 */
export const FORUM_READ_POLICY = {
  terminalDailyUnits: 6_000,
  commerceDailyUnits: 20_000,
  marketSampleDailyRefreshes: 144,
  marketSampleIntervalMs: 10 * 60_000,
  helius: {
    dailyCredits: 10_000,
    rollingCredits: 300_000,
    rollingDays: 32,
    requestsPerWindow: 5,
    windowMs: 1_000,
  },
  jupiter: {
    requestsPerWindow: 50,
    keylessRequestsPerWindow: 25,
    windowMs: 60_000,
  },
  dexscreener: { requestsPerWindow: 60, windowMs: 60_000 },
  geckoterminal: { requestsPerWindow: 8, windowMs: 60_000 },
  tracker: {
    dailyRequests: 70,
    dailyCandles: 12,
    dailyEnrichments: 10,
    rollingRequests: 2_300,
    rollingDays: 32,
  },
} as const;

/**
 * Only the standard JSON-RPC methods used by existing commerce/terminal callers.
 * Helius standard RPC is 1 credit, including getTransaction,
 * getSignaturesForAddress and getTokenAccountsByOwner. Enhanced REST transaction
 * parsing, DAS and Wallet API endpoints are different products, not aliases.
 * Source: https://www.helius.dev/docs/billing/credits (checked 2026-10-31).
 * sendTransaction's cost classification does NOT authorize any submission.
 */
const HELIUS_RPC_CREDITS = {
  getAccountInfo: 1,
  getBalance: 1,
  getBlockHeight: 1,
  getFeeForMessage: 1,
  getFirstAvailableBlock: 1,
  getGenesisHash: 1,
  getLatestBlockhash: 1,
  getMultipleAccounts: 1,
  getSignatureStatuses: 1,
  getSignaturesForAddress: 1,
  getTokenAccountsByOwner: 1,
  getTransaction: 1,
  isBlockhashValid: 1,
  simulateTransaction: 1,
  sendTransaction: 1,
} as const;

/** Unknown or differently cased methods fail closed; never guess their weight. */
export function rpcCreditCost(method: string): number | null {
  return Object.hasOwn(HELIUS_RPC_CREDITS, method)
    ? HELIUS_RPC_CREDITS[method as keyof typeof HELIUS_RPC_CREDITS]
    : null;
}
