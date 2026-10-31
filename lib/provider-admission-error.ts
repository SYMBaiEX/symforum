export type MeteredProvider = "helius" | "dexscreener" | "geckoterminal";

/** Safe classifications only: no URL, key, wallet, request or provider body. */
export class ProviderAdmissionError extends Error {
  readonly code = "provider_admission_denied";
  constructor(
    readonly provider: MeteredProvider,
    readonly reason: "burst" | "daily" | "rolling" | "invalid-request",
    readonly retryAt: number | null,
  ) {
    super("Provider allowance is temporarily unavailable.");
    this.name = "ProviderAdmissionError";
  }
}
