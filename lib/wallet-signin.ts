import type { walletLoginInput } from "./human-auth-proof";

export type WalletChallenge = {
  nonce: string;
  input: ReturnType<typeof walletLoginInput>;
};

type WalletProof = {
  account: { address: string; publicKey: Uint8Array };
  signedMessage: Uint8Array;
  signature: Uint8Array;
  signatureType?: string;
};

export type SignInWallet = {
  name: string;
  features: {
    "solana:signIn": {
      signIn: (input: WalletChallenge["input"]) => Promise<WalletProof[]>;
    };
  };
};

function encoded(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Invoke from the wallet-selection click, with no network await before signIn. */
export function requestWalletProof(
  wallet: SignInWallet,
  challenge: WalletChallenge,
  location: Pick<Location, "host" | "origin">,
  now = Date.now(),
) {
  const { input, nonce } = challenge;
  if (
    input.domain !== location.host ||
    new URL(input.uri).origin !== location.origin ||
    input.nonce !== nonce ||
    !/^[a-zA-Z0-9]{8,}$/.test(nonce) ||
    !Number.isFinite(Date.parse(input.issuedAt)) ||
    Date.parse(input.issuedAt) > now + 60_000 ||
    Date.parse(input.issuedAt) < now - 300_000 ||
    !Number.isFinite(Date.parse(input.expirationTime)) ||
    Date.parse(input.expirationTime) <= now + 5_000
  ) {
    throw new Error(
      "Wallet verification expired or changed. Prepare a new request.",
    );
  }

  // Do not await connect(), fetch(), or a challenge here: retain user activation.
  return wallet.features["solana:signIn"].signIn(input).then(([proof]) => {
    if (!proof) throw new Error("Wallet verification was cancelled.");
    if (
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(proof.account.address) ||
      proof.account.publicKey.length !== 32 ||
      proof.signature.length !== 64 ||
      !proof.signedMessage.length ||
      proof.signedMessage.length > 2048 ||
      (proof.signatureType && proof.signatureType !== "ed25519")
    ) {
      throw new Error("The wallet returned an unsupported sign-in proof.");
    }
    // The server independently checks the exact signed bytes, key, nonce,
    // browser binding, purpose, origin, expiry and account ownership.
    return {
      nonce,
      address: proof.account.address,
      publicKey: encoded(proof.account.publicKey),
      signature: encoded(proof.signature),
      signedMessage: encoded(proof.signedMessage),
    };
  });
}

export function walletFailureMessage(reason: unknown, name: string) {
  const code =
    reason && typeof reason === "object" && "code" in reason
      ? reason.code
      : undefined;
  if (code === 4001)
    return "Sign-in was cancelled. No account changes were made.";
  if (code === -32002)
    return `A ${name} request is already open. Check the wallet extension.`;
  if (reason instanceof Error && reason.message === "Unexpected error")
    return `${name} could not complete sign-in. Unlock the wallet, close any pending wallet requests, then prepare a new request. No transaction is needed.`;
  // Never surface arbitrary extension error bodies, wallet contents or URLs.
  return "Wallet sign-in did not complete. Prepare a new request and try again.";
}
