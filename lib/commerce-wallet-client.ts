import {
  address,
  getBase64Encoder,
  getBase58Decoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";
import { createIdentityWalletClient } from "./identity-wallet-client";
import { getWalletAccountFeature } from "@wallet-standard/ui-features";
import { getWalletAccountForUiWalletAccount } from "@wallet-standard/ui-registry";
import type { SolanaSignAndSendTransactionFeature } from "@solana/wallet-standard-features";
import type { PreparedSwap } from "./swap-router";

export function createCommerceWalletClient() {
  return createIdentityWalletClient();
}
export type CommerceWalletClient = ReturnType<
  typeof createCommerceWalletClient
>;
export type ReviewedTransaction = PreparedSwap & { wallet: string };
type WalletFailurePhase = "account" | "feature" | "request" | "response";
type WalletResponseIssue = "result_count" | "signature_bytes" | null;

/** Only fixed categories/numeric codes may leave the wallet boundary. Never raw errors. */
export class CommerceWalletRequestError extends Error {
  readonly code: number | null;
  constructor(
    readonly phase: WalletFailurePhase,
    cause?: unknown,
    readonly responseIssue: WalletResponseIssue = null,
  ) {
    super("Wallet outcome requires verification. Do not repeat this payment.");
    this.name = "CommerceWalletRequestError";
    this.code =
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      typeof cause.code === "number" &&
      Number.isSafeInteger(cause.code)
        ? cause.code
        : null;
  }
}

/** Validate the exact simulated message before the one-shot wallet request. */
export async function verifyPreparedTransaction(prepared: ReviewedTransaction) {
  const transaction = getTransactionDecoder().decode(
    getBase64Encoder().encode(prepared.transactionBase64),
  );
  const message = getCompiledTransactionMessageDecoder().decode(
    transaction.messageBytes,
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(transaction.messageBytes),
  );
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (
    hash !== prepared.messageHash ||
    message.version !== prepared.transactionVersion ||
    message.staticAccounts[0] !== prepared.wallet ||
    Object.keys(transaction.signatures).length !== 1 ||
    transaction.signatures[address(prepared.wallet)] !== null
  )
    throw new Error(
      "Transaction does not match the simulated review. Nothing was sent.",
    );
  return Object.freeze({ ...prepared });
}

/** Wallet Standard only. No injected Ethereum globals, private keys, RPC resend, or signing fallback. */
export async function requestReviewedTransaction(
  client: CommerceWalletClient,
  prepared: ReviewedTransaction,
) {
  const current = client.wallet.getState().connected;
  if (
    !current ||
    current.account.address !== prepared.wallet ||
    !current.account.chains.includes("solana:mainnet") ||
    !current.supportedTransactionVersions.has(prepared.transactionVersion)
  )
    throw new CommerceWalletRequestError("account");
  let feature: SolanaSignAndSendTransactionFeature["solana:signAndSendTransaction"];
  let account: ReturnType<typeof getWalletAccountForUiWalletAccount>;
  try {
    feature = getWalletAccountFeature(
      current.account,
      "solana:signAndSendTransaction",
    ) as typeof feature;
    account = getWalletAccountForUiWalletAccount(current.account);
  } catch (cause) {
    throw new CommerceWalletRequestError("feature", cause);
  }
  // Exactly one Wallet Standard request; never resend or switch signing methods on error.
  let results: unknown;
  try {
    results = await feature.signAndSendTransaction({
      account,
      transaction: Uint8Array.from(
        getBase64Encoder().encode(prepared.transactionBase64),
      ),
      chain: "solana:mainnet",
      options: {
        skipPreflight: false,
        maxRetries: 0,
        commitment: "confirmed",
        preflightCommitment: "confirmed",
        minContextSlot: prepared.simulationSlot,
      },
    });
  } catch (cause) {
    throw new CommerceWalletRequestError("request", cause);
  }
  if (!Array.isArray(results) || results.length !== 1)
    throw new CommerceWalletRequestError("response", undefined, "result_count");
  const signature: unknown = results[0]?.signature;
  // Extensions/iframes can return genuine bytes from a different JS realm.
  // instanceof rejects those. Keep the exact Uint8Array/64-byte requirement.
  if (
    !ArrayBuffer.isView(signature) ||
    Object.prototype.toString.call(signature) !== "[object Uint8Array]" ||
    signature.byteLength !== 64 ||
    !("length" in signature) ||
    signature.length !== 64
  )
    throw new CommerceWalletRequestError(
      "response",
      undefined,
      "signature_bytes",
    );
  return getBase58Decoder().decode(Uint8Array.from(signature as Uint8Array));
}
