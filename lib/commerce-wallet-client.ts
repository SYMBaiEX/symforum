import {
  createClient,
  address,
  getBase64Encoder,
  getBase58Decoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";
import { walletWithoutSigner } from "@solana/kit-plugin-wallet";
import { getWalletAccountFeature } from "@wallet-standard/ui-features";
import { getWalletAccountForUiWalletAccount } from "@wallet-standard/ui-registry";
import type { PreparedSwap } from "./swap-router";

export function createCommerceWalletClient() {
  return createClient().use(
    walletWithoutSigner({
      chain: "solana:mainnet",
      autoConnect: false,
      storage: null,
      filter: (wallet) =>
        wallet.features.includes("solana:signAndSendTransaction"),
    }),
  );
}
export type CommerceWalletClient = ReturnType<
  typeof createCommerceWalletClient
>;
export type ReviewedTransaction = PreparedSwap & { wallet: string };

/** Validate the exact simulated message before enabling the separate wallet-approval click. */
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
    throw new Error(
      "The connected wallet changed or cannot sign this transaction version.",
    );
  const feature = getWalletAccountFeature(
    current.account,
    "solana:signAndSendTransaction",
  ) as {
    signAndSendTransaction(input: {
      account: ReturnType<typeof getWalletAccountForUiWalletAccount>;
      transaction: Uint8Array;
      chain: "solana:mainnet";
      options: { skipPreflight: false; maxRetries: 0; commitment: "confirmed" };
    }): Promise<readonly { signature: Uint8Array }[]>;
  };
  // First asynchronous operation invokes the wallet directly from the user's click.
  const results = await feature.signAndSendTransaction({
    account: getWalletAccountForUiWalletAccount(current.account),
    transaction: Uint8Array.from(
      getBase64Encoder().encode(prepared.transactionBase64),
    ),
    chain: "solana:mainnet",
    options: { skipPreflight: false, maxRetries: 0, commitment: "confirmed" },
  });
  if (
    results.length !== 1 ||
    !(results[0].signature instanceof Uint8Array) ||
    results[0].signature.length !== 64
  )
    throw new Error("Wallet outcome is uncertain. Do not repeat this payment.");
  return getBase58Decoder().decode(results[0].signature);
}
