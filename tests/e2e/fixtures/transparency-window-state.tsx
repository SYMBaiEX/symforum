import { getFunctionName, type FunctionReference } from "convex/server";
import type { PromotionTransparency } from "../../../components/trading/terminal-api";
export const queries: { name: string; args: unknown }[] = [],
  forbidden: string[] = [];
Object.assign(window, { __transparencyWindow: { queries, forbidden } });
const params = new URLSearchParams(location.search),
  count = Number(params.get("count") ?? 3);
export function useQuery(
  ref: FunctionReference<"query">,
  args: unknown,
): PromotionTransparency | undefined {
  const name = getFunctionName(ref);
  queries.push({ name, args });
  if (name !== "forumTerminalTransparency:getTransparency")
    throw new Error(`Forbidden query ${name}`);
  if (params.has("loading")) return undefined;
  return {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    treasury: "11111111111111111111111111111111",
    promotionAmountRaw: params.has("zero") ? "0" : "111000000",
    treasuryAmountRaw: params.has("zero") ? "0" : "74000000",
    burnAmountRaw: params.has("zero") ? "0" : "37000000",
    verifiedPromotions: params.has("zero") ? 0 : 37,
    latestVerifiedAt: count ? Date.parse("2026-10-31T13:00:00Z") : null,
    coverage: "verified-promotion-receipts",
    historyComplete: params.has("complete"),
    receipts: Array.from({ length: count }, (_, i) => ({
      signature: `inert-verified-signature-${i}`,
      amountRaw: "3000000",
      treasuryAmountRaw: "2000000",
      burnAmountRaw: "1000000",
      verifiedAt: Date.parse("2026-10-31T13:00:00Z") - i * 60000,
    })),
  };
}
export function useAction() {
  return async () => {
    forbidden.push("action");
    throw new Error("All actions forbidden");
  };
}
export function useMutation() {
  return async () => {
    forbidden.push("mutation");
    throw new Error("All mutations forbidden");
  };
}
