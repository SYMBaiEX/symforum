import type { TerminalWalletReadState } from "@/lib/forum-terminal-model";
import { balanceLabel } from "./terminal-format";

export const WALLET_SOL_MINT = "So11111111111111111111111111111111111111112";

/** Unknown input stays unknown; formatting is not balance verification. */
export function walletAmountLabel(raw: unknown, decimals: unknown) {
  return typeof raw === "string" && typeof decimals === "number"
    ? balanceLabel(raw, decimals)
    : "Unavailable";
}

/** Describe returned limits only. Never calculate a reserve or a Max amount. */
export function walletSolReadings(state: TerminalWalletReadState) {
  const sol = state.balances.find(
    (balance) => balance.mint === WALLET_SOL_MINT,
  );
  const balance =
    sol?.decimals === 9
      ? walletAmountLabel(sol.rawAmount, sol.decimals)
      : "Unavailable";
  const estimate = walletAmountLabel(state.maxSolRaw, 9);
  const reserve = walletAmountLabel(state.feeReserveLamports, 9);
  // Invalid or inconsistent values must not be promoted into a verified limit.
  const hasVerifiedLimit =
    balance !== "Unavailable" &&
    estimate !== "Unavailable" &&
    reserve !== "Unavailable" &&
    BigInt(state.maxSolRaw!) + BigInt(state.feeReserveLamports!) <=
      BigInt(sol!.rawAmount);
  return {
    balance,
    estimate: hasVerifiedLimit ? estimate : "Unavailable",
    reserve: hasVerifiedLimit ? reserve : "Unavailable",
  };
}
