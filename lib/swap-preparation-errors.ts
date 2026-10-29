/** Fixed public messages only: never serialize provider bodies, URLs or wallet data. */
export const SWAP_PREPARATION_MESSAGES = {
  rpc_blocked:
    "The Solana RPC blocked the server's verification request. No wallet request was made. Try again after the connection is restored.",
  rpc_rate_limited:
    "Solana verification is temporarily rate limited. No wallet request was made. Wait before requesting a fresh quote.",
  rpc_unavailable:
    "Solana verification is temporarily unavailable. No wallet request was made. Request a fresh quote later.",
  quote_expired:
    "The quote expired before preparation finished. No wallet request was made. Review a fresh quote.",
  simulation_failed:
    "The transaction did not pass simulation. Check your balance, including SOL for network fees. No wallet request was made.",
  insufficient_tokens:
    "The selected wallet's token account does not have enough spendable tokens. No wallet request was made.",
  preparation_not_completed:
    "This route could not pass preparation and simulation. No wallet request was made. Review a fresh quote.",
} as const;
export type SwapPreparationIssue = keyof typeof SWAP_PREPARATION_MESSAGES;
export class SwapRpcError extends Error {
  constructor(
    readonly code: "rpc_blocked" | "rpc_rate_limited" | "rpc_unavailable",
  ) {
    super(SWAP_PREPARATION_MESSAGES[code]);
    this.name = "SwapRpcError";
  }
}
export function swapPreparationIssue(error: unknown): SwapPreparationIssue {
  if (error instanceof SwapRpcError) return error.code;
  const message = error instanceof Error ? error.message : "";
  if (message === "Quote expired. Review a fresh quote.")
    return "quote_expired";
  if (
    message === "Simulation failed. Nothing was signed or sent." ||
    message ===
      "Final transaction simulation failed. Nothing was signed or sent."
  )
    return "simulation_failed";
  if (message === "No single eligible token account has enough balance.")
    return "insufficient_tokens";
  return "preparation_not_completed";
}
export function publicSwapPreparationError(error: unknown): string {
  const data =
    error && typeof error === "object" && "data" in error
      ? error.data
      : undefined;
  return (
    Object.values(SWAP_PREPARATION_MESSAGES).find(
      (message) => message === data,
    ) ?? SWAP_PREPARATION_MESSAGES.preparation_not_completed
  );
}
