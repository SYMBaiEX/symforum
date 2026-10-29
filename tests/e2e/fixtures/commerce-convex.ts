// Isolated fake boundary. No production data, session or network transport.
import { getFunctionName } from "convex/server";
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
  if (args === "skip") return undefined;
  const name = getFunctionName(ref);
  if (name === "forumCommerce:getConfig")
    return {
      swapsEnabled: !location.search.includes("disabled"),
      promotionsEnabled: true,
      treasury: "11111111111111111111111111111111",
      platformFeeBps: 25,
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
  if (name === "forumCommerce:resolveThreadTokens") return [];
  if (name === "forumCommerce:getThreadMint") return null;
  if (name === "forumPromotions:listPromoted") return [];
  if (name.endsWith(":listMine")) return [];
  return undefined;
}
function operation(ref: Parameters<typeof getFunctionName>[0]) {
  const name = getFunctionName(ref);
  return async (args: unknown) => {
    const response = await fetch(`/__commerce/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error("Mock operation failed");
    return response.json();
  };
}
export const useMutation = operation;
export const useAction = operation;
