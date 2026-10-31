// Isolated fake boundary. No production data, session or network transport.
import { getFunctionName } from "convex/server";
import { useCallback, useSyncExternalStore } from "react";
let recoveryResolved = false,
  recoveryRevision = 0;
let signedReceipt: { signature: string; finalized?: boolean } | null = null;
const recoveryListeners = new Set<() => void>();
window.addEventListener("commerce:signed-receipt", (event) => {
  signedReceipt = (event as CustomEvent).detail;
  recoveryRevision++;
  recoveryListeners.forEach((listener) => listener());
});
window.addEventListener("commerce:resolve-recovery", () => {
  recoveryResolved = true;
  recoveryRevision++;
  recoveryListeners.forEach((listener) => listener());
});
const subscribeRecovery = (listener: () => void) => {
  recoveryListeners.add(listener);
  return () => {
    recoveryListeners.delete(listener);
  };
};
const getRecoveryRevision = () => recoveryRevision;
const SOL = "So11111111111111111111111111111111111111112",
  USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  SYMF = "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump";
export function useConvexAuth() {
  return {
    isAuthenticated: !location.search.includes("guest"),
    isLoading: false,
  };
}
export function useQuery(
  ref: Parameters<typeof getFunctionName>[0],
  args: unknown,
) {
  useSyncExternalStore(
    subscribeRecovery,
    getRecoveryRevision,
    getRecoveryRevision,
  );
  if (args === "skip") return undefined;
  const name = getFunctionName(ref);
  if (name === "forumCommerce:getWalletSession")
    return {
      authUserId: "test-reader",
      wallets: location.search.includes("unlinked")
        ? []
        : [
            window.__commerceFixtureWallet ??
              "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY",
          ],
    };
  if (name === "forumCommerce:getConfig")
    return {
      automaticPostTokens: true,
      promotionCalendar: true,
      swapsEnabled: !location.search.includes("disabled"),
      signatureFirstEnabled: location.search.includes("signaturefirst"),
      managedEnabled: location.search.includes("managed"),
      promotionsEnabled: true,
      treasury: "11111111111111111111111111111111",
      platformFeeBps: location.search.includes("managed") ? 50 : 25,
      promotionAmountRaw: "10000000000",
      symfMint: SYMF,
    };
  if (name === "forumCommerce:searchTokens")
    return [
      {
        mint: SOL,
        symbol: "SOL",
        name: "Solana",
        decimals: 9,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      },
      {
        mint: USDC,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      },
    ];
  if (name === "forumCommerce:resolveThreadTokens")
    return location.search.includes("postverified")
      ? [
          {
            mint: USDC,
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
            tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          },
        ]
      : [];
  if (name === "forumCommerce:getThreadMint")
    return location.search.includes("postchecking") ||
      location.search.includes("postverified")
      ? USDC
      : null;
  if (name === "forumPostTokens:status")
    return location.search.includes("postchecking")
      ? { mint: USDC, status: "checking" }
      : location.search.includes("postverified")
        ? { mint: USDC, status: "verified" }
        : null;
  if (name === "forumPromotions:calendar") {
    const hour = 3_600_000;
    const first = Math.ceil((Date.now() + 660_000) / hour) * hour;
    return {
      categoryId: "board-fixture",
      generatedAt: Date.now(),
      amountRaw: "10000000000",
      decimals: 6,
      durationMs: 86400000,
      slots: Array.from({ length: 7 * 24 - 1 }, (_, i) => ({
        startsAt: first + i * hour,
        endsAt: first + i * hour + 86400000,
        remaining: i === 3 ? 0 : 5,
      })),
    };
  }
  if (name === "forumPromotions:listPromoted") return [];
  if (name === "forumSwaps:listMine" && signedReceipt)
    return [
      {
        quoteId: "quote-fixture",
        wallet: window.__commerceFixtureWallet,
        status: signedReceipt.finalized ? "confirmed" : "submitted",
        signature: signedReceipt.signature,
        inputMint: SOL,
        outputMint: USDC,
        amountRaw: "10000000",
        createdAt: 0,
        issue: null,
        recovery: {
          state: signedReceipt.finalized ? "resolved" : "scheduled",
          reason: "checking_receipt",
          attempts: 1,
          nextCheckAt: Date.now() + 5000,
          progress: "confirmed",
        },
      },
    ];
  if (name.endsWith(":listMine"))
    return location.search.includes("held")
      ? [
          {
            quoteId: "held-fixture",
            wallet: "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY",
            status: recoveryResolved ? "failed" : "held",
            signature: null,
            inputMint: SOL,
            outputMint: USDC,
            amountRaw: "1000000",
            createdAt: 0,
            issue: recoveryResolved
              ? "reconciled_expired_not_landed"
              : "wallet_outcome_unknown",
            ...(location.search.includes("auto")
              ? {
                  recovery: {
                    state: recoveryResolved ? "resolved" : "scheduled",
                    reason: recoveryResolved ? "resolved" : "waiting_expiry",
                    attempts: recoveryResolved ? 1 : 0,
                    nextCheckAt: recoveryResolved ? 0 : Date.now() + 900000,
                  },
                }
              : {}),
          },
        ]
      : [];
  return undefined;
}
function useOperation(ref: Parameters<typeof getFunctionName>[0]) {
  const name = getFunctionName(ref);
  return useCallback(
    async (args: unknown) => {
      const response = await fetch(`/__commerce/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!response.ok) throw new Error("Mock operation failed");
      return response.json();
    },
    [name],
  );
}
export const useMutation = useOperation;
export const useAction = useOperation;
