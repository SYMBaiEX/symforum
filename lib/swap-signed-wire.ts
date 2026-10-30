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
    throw Error("Invalid signed transaction.");
  const bytes = getBase64Encoder().encode(wire);
  if (bytes.length > (expected.transactionVersion === 1 ? 4096 : 1232))
    throw Error("Invalid signed transaction.");
  const tx = getTransactionDecoder().decode(bytes),
    message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const signature = tx.signatures[address(expected.wallet)];
  if (
    getBase64EncodedWireTransaction(tx) !== wire ||
    message.version !== expected.transactionVersion ||
    message.staticAccounts[0] !== expected.wallet ||
    Object.keys(tx.signatures).length !== 1 ||
    !signature ||
    signature.length !== 64 ||
    (await digest(Uint8Array.from(tx.messageBytes))) !== expected.messageHash
  )
    throw Error("Signed transaction differs from the simulated message.");
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(getAddressEncoder().encode(address(expected.wallet))),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      key,
      Uint8Array.from(signature),
      Uint8Array.from(tx.messageBytes),
    ))
  )
    throw Error("Invalid transaction signature.");
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
