type Preview = {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  minimumOutputAmountRaw: string;
  platformFeeRaw: string;
  platformFeeBps: number;
};

/** Refresh may improve execution, never silently worsen the user's protected floor or fee. */
export function refreshedQuoteNeedsReview(previous: Preview, next: Preview) {
  return (
    previous.inputMint !== next.inputMint ||
    previous.outputMint !== next.outputMint ||
    previous.amountRaw !== next.amountRaw ||
    previous.platformFeeBps !== next.platformFeeBps ||
    previous.platformFeeRaw !== next.platformFeeRaw ||
    BigInt(next.minimumOutputAmountRaw) <
      BigInt(previous.minimumOutputAmountRaw)
  );
}

/** Client checks complement, never replace, server admission and wallet approval. */
export function walletHandoffAllowed(expiresAt: number, now = Date.now()) {
  return (
    Number.isFinite(expiresAt) &&
    expiresAt > now &&
    document.visibilityState !== "hidden" &&
    navigator.onLine
  );
}
