import { createClient } from "@solana/kit";
import { walletWithoutSigner } from "@solana/kit-plugin-wallet";
import { getWalletAccountFeature } from "@wallet-standard/ui-features";
import { getWalletAccountForUiWalletAccount } from "@wallet-standard/ui-registry";
import type { UiWalletAccount } from "@wallet-standard/ui";
import {
  requestMessageProof,
  type WalletChallenge,
  type WalletProof,
} from "./wallet-signin";

export function createIdentityWalletClient() {
  // Authentication only: no RPC, transaction payer, silent connection, or
  // persisted wallet address. Better Auth owns the actual authenticated session.
  return createClient().use(
    walletWithoutSigner({
      chain: "solana:mainnet",
      autoConnect: false,
      storage: null,
      filter: (wallet) =>
        wallet.features.includes("solana:signIn") ||
        wallet.features.includes("solana:signMessage"),
    }),
  );
}
export type IdentityWalletClient = ReturnType<
  typeof createIdentityWalletClient
>;

function assertSelectedAccount(
  client: IdentityWalletClient,
  account: UiWalletAccount,
) {
  const current = client.wallet.getState().connected?.account;
  if (
    !current ||
    current.address !== account.address ||
    current.publicKey.length !== account.publicKey.length ||
    !Array.from(current.publicKey).every(
      (byte, index) => byte === account.publicKey[index],
    ) ||
    !current.chains.includes("solana:mainnet") ||
    !current.features.includes("solana:signMessage")
  )
    throw new Error("The connected wallet account changed. Start again.");
}

export function requestIdentityMessageProof(
  client: IdentityWalletClient,
  account: UiWalletAccount,
  challenge: WalletChallenge,
  location: Pick<Location, "host" | "origin">,
  now = Date.now(),
  onRequest?: () => void,
) {
  assertSelectedAccount(client, account);
  const feature = getWalletAccountFeature(account, "solana:signMessage") as {
    signMessage: (input: {
      account: ReturnType<typeof getWalletAccountForUiWalletAccount>;
      message: Uint8Array;
    }) => Promise<readonly Omit<WalletProof, "account">[]>;
  };
  const rawAccount = getWalletAccountForUiWalletAccount(account);
  // Use the SDK's registered raw account for wallets requiring reference
  // identity, but bind the proof to the SDK's verified immutable snapshot.
  // The SDK's signature-only helper drops signedMessage, so resolve its public
  // account feature here to retain the existing exact-signed-bytes gate.
  return requestMessageProof(
    async (message) => {
      onRequest?.();
      const result = await feature.signMessage({
        account: rawAccount,
        message,
      });
      assertSelectedAccount(client, account);
      return result;
    },
    account,
    challenge,
    location,
    now,
  );
}
