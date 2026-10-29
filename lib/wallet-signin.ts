import type { walletLoginInput } from "./human-auth-proof";
import { createSignInMessage } from "@solana/wallet-standard-util";

export type WalletChallenge = {
  nonce: string;
  input: ReturnType<typeof walletLoginInput>;
};

type PublicKeyBytes = Readonly<ArrayLike<number>> & Iterable<number>;
type WalletProof = {
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
export type MessageSignWallet = {
  name: string;
  readonly accounts: readonly MessageWalletAccount[];
  features: {
    "standard:connect": {
      connect: () => Promise<{ accounts: readonly MessageWalletAccount[] }>;
    };
    "solana:signMessage": {
      signMessage: (input: {
        account: MessageWalletAccount;
        message: Uint8Array;
      }) => Promise<readonly Omit<WalletProof, "account">[]>;
    };
  };
};

export function supportsMessageSigning(wallet: {
  name: string;
  accounts: readonly MessageWalletAccount[];
  features: Readonly<Record<string, unknown>>;
}): wallet is MessageSignWallet {
  return (
    typeof (
      wallet.features["standard:connect"] as
        MessageSignWallet["features"]["standard:connect"] | undefined
    )?.connect === "function" &&
    typeof (
      wallet.features["solana:signMessage"] as
        MessageSignWallet["features"]["solana:signMessage"] | undefined
    )?.signMessage === "function"
  );
}

export function isInternalWalletError(reason: unknown) {
  return (
    !!reason &&
    typeof reason === "object" &&
    (("code" in reason && reason.code === -32603) ||
      ("message" in reason && reason.message === "Unexpected error"))
  );
}

export type SignInWallet = {
  name: string;
  features: {
    "solana:signIn": {
      signIn: (input: WalletChallenge["input"]) => Promise<WalletProof[]>;
    };
  };
};

function encoded(bytes: Iterable<number>) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Invoke from the wallet-selection click, with no network await before signIn. */
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

export function requestWalletProof(
  wallet: SignInWallet,
  challenge: WalletChallenge,
  location: Pick<Location, "host" | "origin">,
  now = Date.now(),
) {
  validateChallenge(challenge, location, now);
  // No connect(), fetch(), or asynchronous preparation before the popup.
  return wallet.features["solana:signIn"]
    .signIn(challenge.input)
    .then(([proof]) => serializeProof(proof, challenge.nonce));
}

export function connectMessageWallet(wallet: MessageSignWallet) {
  return wallet.features["standard:connect"].connect().then(({ accounts }) => {
    const compatible = accounts.filter(
      (account) =>
        account.publicKey.length === 32 &&
        account.chains.some((chain) => chain.startsWith("solana:")) &&
        account.features.includes("solana:signMessage"),
    );
    if (!compatible.length)
      throw new Error("No message-signing Solana account was connected.");
    return compatible;
  });
}

/** Explicit compatibility path, never an automatic second signing attempt. */
export function requestMessageProof(
  wallet: MessageSignWallet,
  account: MessageWalletAccount,
  challenge: WalletChallenge,
  location: Pick<Location, "host" | "origin">,
  now = Date.now(),
) {
  validateChallenge(challenge, location, now);
  if (
    !wallet.accounts.some(
      (current) =>
        current.address === account.address &&
        current.publicKey.length === account.publicKey.length &&
        [...current.publicKey].every(
          (byte, index) => byte === account.publicKey[index],
        ) &&
        current.features.includes("solana:signMessage"),
    )
  )
    throw new Error("The connected wallet account changed. Start again.");
  const message = createSignInMessage({
    ...challenge.input,
    address: account.address,
  });
  return wallet.features["solana:signMessage"]
    .signMessage({ account, message })
    .then(([output]) => {
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
    return `${name} could not connect this account. Check open wallet requests or choose another wallet.`;
  if (isInternalWalletError(reason) && method === "signMessage")
    return `${name} could not sign the message. Check that this account supports message signing, or choose another wallet.`;
  if (isInternalWalletError(reason))
    return `${name} returned an internal signing error. This does not necessarily mean the wallet is locked. You can use the explicit message sign-in option, or choose another wallet.`;
  // Never surface arbitrary extension error bodies, wallet contents or URLs.
  return "Wallet sign-in did not complete. Prepare a new request and try again.";
}
