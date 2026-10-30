import {
  address,
  getAddressEncoder,
  getBase64Encoder,
  getBase64Decoder,
  getBase58Decoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  getBase64EncodedWireTransaction,
} from "@solana/kit";

export type SignedSwapBinding = {
  wallet: string;
  messageHash: string;
  transactionVersion: number;
};
/** Fixed categories only: never expose the signed wire or a provider error. */
export type SignedSwapValidationIssue =
  | "wire_format"
  | "wire_size"
  | "wire_decode"
  | "wire_encode"
  | "noncanonical_wire"
  | "version_mismatch"
  | "payer_mismatch"
  | "signer_count"
  | "signature_missing"
  | "signature_length"
  | "message_mismatch"
  | "crypto_unavailable"
  | "invalid_signature";
export class SignedSwapValidationError extends Error {
  constructor(
    readonly issue: SignedSwapValidationIssue,
    message: string,
  ) {
    super(message);
    this.name = "SignedSwapValidationError";
  }
}
async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
/** Browser and Convex. The signature must authorize the exact simulated message. */
export async function inspectSignedSwap(
  wire: string,
  expected: SignedSwapBinding,
) {
  if (
    typeof wire !== "string" ||
    wire.length > 6000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(wire)
  )
    throw new SignedSwapValidationError(
      "wire_format",
      "Invalid signed transaction.",
    );
  const bytes = getBase64Encoder().encode(wire);
  if (bytes.length > (expected.transactionVersion === 1 ? 4096 : 1232))
    throw new SignedSwapValidationError(
      "wire_size",
      "Invalid signed transaction.",
    );
  let tx: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  let message: ReturnType<
    ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]
  >;
  try {
    tx = getTransactionDecoder().decode(bytes);
    message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  } catch {
    throw new SignedSwapValidationError(
      "wire_decode",
      "Invalid signed transaction.",
    );
  }
  const signature = tx.signatures[address(expected.wallet)];
  const mismatch = (issue: SignedSwapValidationIssue): never => {
    throw new SignedSwapValidationError(
      issue,
      "Signed transaction differs from the simulated message.",
    );
  };
  if (getBase64EncodedWireTransaction(tx) !== wire)
    mismatch("noncanonical_wire");
  if (message.version !== expected.transactionVersion)
    mismatch("version_mismatch");
  if (message.staticAccounts[0] !== expected.wallet) mismatch("payer_mismatch");
  if (Object.keys(tx.signatures).length !== 1) mismatch("signer_count");
  if (!signature) return mismatch("signature_missing");
  if (signature.length !== 64) mismatch("signature_length");
  if ((await digest(Uint8Array.from(tx.messageBytes))) !== expected.messageHash)
    mismatch("message_mismatch");
  let valid: boolean;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(getAddressEncoder().encode(address(expected.wallet))),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "Ed25519",
      key,
      Uint8Array.from(signature),
      Uint8Array.from(tx.messageBytes),
    );
  } catch {
    throw new SignedSwapValidationError(
      "crypto_unavailable",
      "Signature verification is unavailable.",
    );
  }
  if (!valid)
    throw new SignedSwapValidationError(
      "invalid_signature",
      "Invalid transaction signature.",
    );
  return {
    signature: getBase58Decoder().decode(signature),
    wireHash: await digest(Uint8Array.from(bytes)),
    messageHash: expected.messageHash,
  };
}
export function signedBytesToBase64(value: unknown) {
  if (
    !ArrayBuffer.isView(value) ||
    Object.prototype.toString.call(value) !== "[object Uint8Array]" ||
    value.byteLength > 4096 ||
    value.byteLength < 65
  )
    throw Error("Invalid signed transaction bytes.");
  return getBase64Decoder().decode(Uint8Array.from(value as Uint8Array));
}
