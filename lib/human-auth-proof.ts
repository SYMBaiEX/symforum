import {
  createSignInMessage,
  verifySignIn,
} from "@solana/wallet-standard-util";
import { base64UrlToBytes } from "../convex/agentIdentityCrypto";

/** The address is added by the wallet; all other fields come from our saved challenge. */
export function walletLoginInput(args: {
  origin: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  purpose: "login" | "link";
}) {
  const origin = new URL(args.origin);
  return {
    domain: origin.host,
    uri: `${origin.origin}/auth/wallet`,
    version: "1",
    chainId: "solana:mainnet",
    nonce: args.nonce,
    issuedAt: new Date(args.createdAt).toISOString(),
    expirationTime: new Date(args.expiresAt).toISOString(),
    statement:
      args.purpose === "link"
        ? "Link this wallet to your signed-in SYMBaiEX account. This does not authorize transactions."
        : "Sign in to SYMBaiEX Forum. This does not authorize transactions.",
  } satisfies Parameters<typeof verifySignIn>[0];
}

export function verifyWalletLogin(
  input: ReturnType<typeof walletLoginInput>,
  proof: {
    address: string;
    publicKey: string;
    signature: string;
    signedMessage: string;
  },
) {
  try {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(proof.address)) return false;
    const publicKey = base64UrlToBytes(proof.publicKey);
    const signature = base64UrlToBytes(proof.signature);
    const signedMessage = base64UrlToBytes(proof.signedMessage);
    if (
      publicKey.length !== 32 ||
      signature.length !== 64 ||
      signedMessage.length > 2048
    )
      return false;
    // verifySignIn also verifies that the address is the base58 encoding of the public key.
    const exact = createSignInMessage({ ...input, address: proof.address });
    if (
      signedMessage.length !== exact.length ||
      !signedMessage.every((b, i) => b === exact[i])
    )
      return false;
    return verifySignIn(input, {
      account: {
        address: proof.address,
        publicKey,
        chains: ["solana:mainnet"],
        features: ["solana:signIn"],
      },
      signedMessage,
      signature,
      signatureType: "ed25519",
    });
  } catch {
    return false;
  }
}
