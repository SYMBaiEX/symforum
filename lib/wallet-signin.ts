import type { walletLoginInput } from "./human-auth-proof";
import { createSignInMessage } from "@solana/wallet-standard-util";

export type WalletChallenge = {
  nonce: string;
  input: ReturnType<typeof walletLoginInput>;
};

type PublicKeyBytes = Readonly<ArrayLike<number>> & Iterable<number>;
export type WalletProof = {
  account: { address: string; publicKey: PublicKeyBytes };
  signedMessage: Uint8Array;
  signature: Uint8Array;
  signatureType?: string;
};

export type MessageWalletAccount = {
  readonly address: string;
  readonly publicKey: PublicKeyBytes;
  readonly chains: readonly string[];
  readonly features: readonly string[];
};
export function isInternalWalletError(reason: unknown) {
  return (
    !!reason &&
    typeof reason === "object" &&
    (("code" in reason && reason.code === -32603) ||
      ("message" in reason && reason.message === "Unexpected error"))
  );
}

function encoded(bytes: Iterable<number>) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Validate before invoking any wallet signature method. */
function validateChallenge(
  challenge: WalletChallenge,
  location: Pick<Location, "host" | "origin">,
  now: number,
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
}

function serializeProof(proof: WalletProof | undefined, nonce: string) {
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
}

export function requestSiwsProof(
  signIn: (input: WalletChallenge["input"]) => Promise<WalletProof>,
  challenge: WalletChallenge,
  location: Pick<Location, "host" | "origin">,
  now = Date.now(),
) {
  validateChallenge(challenge, location, now);
  return signIn(challenge.input).then((proof) =>
    serializeProof(proof, challenge.nonce),
  );
}

/** Explicit message sign-in after connection; never an automatic retry. */
export function requestMessageProof(
  signMessage: (
    message: Uint8Array,
  ) => Promise<readonly Omit<WalletProof, "account">[]>,
  account: MessageWalletAccount,
  challenge: WalletChallenge,
  location: Pick<Location, "host" | "origin">,
  now = Date.now(),
) {
  validateChallenge(challenge, location, now);
  const message = createSignInMessage({
    ...challenge.input,
    address: account.address,
  });
  return signMessage(message).then(([output]) => {
    if (!output) throw new Error("Wallet verification was cancelled.");
    // Never accept prefixed/rewritten messages or alternate signature schemes.
    if (
      output.signedMessage.length !== message.length ||
      !output.signedMessage.every((byte, index) => byte === message[index])
    )
      throw new Error("The wallet changed the sign-in message.");
    return serializeProof({ ...output, account }, challenge.nonce);
  });
}

export function walletFailureMessage(
  reason: unknown,
  name: string,
  method: "signIn" | "connect" | "signMessage" = "signIn",
) {
  const code =
    reason && typeof reason === "object" && "code" in reason
      ? reason.code
      : undefined;
  if (code === 4001)
    return "Sign-in was cancelled. No account changes were made.";
  if (code === -32002)
    return `A ${name} request is already open. Check the wallet extension.`;
  if (isInternalWalletError(reason) && method === "connect")
    return `${name} returned an internal connection error. Sign-in verification has not started.`;
  if (isInternalWalletError(reason) && method === "signMessage")
    return `${name} could not sign the message. Check that this account supports message signing, or choose another wallet.`;
  if (isInternalWalletError(reason))
    return `${name} returned an internal signing error. This does not necessarily mean the wallet is locked. Choose another wallet or start a fresh request.`;
  // Never surface arbitrary extension error bodies, wallet contents or URLs.
  return "Wallet sign-in did not complete. Prepare a new request and try again.";
}
