// Invented responses only. No client, provider, signer or send method exists.
import { useCallback } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { TerminalWalletReadState } from "../../../lib/forum-terminal-model";

export const selectedMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const wallet = "11111111111111111111111111111111";
const sol = "So11111111111111111111111111111111111111112";
const scenario = new URLSearchParams(location.search).get("scenario");
const balances = [
  { mint: sol, rawAmount: "1000000000", decimals: 9 },
  { mint: selectedMint, rawAmount: "123456789", decimals: 6 },
];
if (scenario === "zero")
  balances.forEach((balance) => {
    balance.rawAmount = "0";
  });
if (scenario === "missing-sol") balances.splice(0, 1);
if (scenario === "missing-selected") balances.splice(1, 1);
if (scenario === "malformed")
  balances.forEach((balance) => {
    balance.rawAmount = "not-a-number";
  });
if (scenario === "unsupported-decimals")
  balances.forEach((balance) => {
    balance.decimals = 19;
  });
if (scenario === "large")
  balances.forEach((balance) => {
    balance.rawAmount = "18446744073709551615";
  });
const calls: { name: string; args: unknown }[] = [];
Object.assign(window, { __walletReadability: { calls } });
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(
    async (args: {
      wallet: string;
      selectedMint: string;
    }): Promise<TerminalWalletReadState | null> => {
      calls.push({ name, args });
      if (name !== "forumTerminal:getWalletReadState")
        throw new Error(`Forbidden fixture action: ${name}`);
      if (scenario === "reject") throw new Error("Invented read failure");
      return {
        wallet:
          scenario === "foreign-wallet"
            ? "different-fixture-wallet"
            : args.wallet,
        checkedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        slot: 123,
        balances,
        maxSolRaw:
          scenario === "verified-limit" || scenario === "unverified-limit"
            ? "800000000"
            : null,
        feeReserveLamports: scenario === "verified-limit" ? "200000000" : null,
      };
    },
    [name],
  );
}
export function useQuery() {
  throw new Error("Forbidden fixture query");
}
export function useMutation() {
  throw new Error("Forbidden fixture mutation");
}
