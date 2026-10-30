import {
  address,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getPublicKeyFromAddress,
  verifySignature,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import type { PaymentRequirements } from "@x402/core/types";
import {
  RESEARCH_AMOUNT,
  RESEARCH_ASSET,
  RESEARCH_TREASURY,
} from "./forum-research";
import { TOKEN_PROGRAM, PROMOTION_MEMO_PROGRAM } from "./forum-commerce";

export async function inspectResearchWire(
  wire: string,
  wallet: string,
  requirements: PaymentRequirements,
  signed: boolean,
) {
  if (wire.length > 1800 || !/^[A-Za-z0-9+/]+={0,2}$/.test(wire))
    throw new Error("Invalid payment wire.");
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
  if (getBase64EncodedWireTransaction(tx) !== wire)
    throw new Error("Noncanonical payment wire.");
  const message = getCompiledTransactionMessageDecoder().decode(
    tx.messageBytes,
  );
  const feePayer = String(requirements.extra.feePayer);
  if (
    message.version !== 0 ||
    (message.addressTableLookups ?? []).length ||
    message.staticAccounts[0] !== feePayer ||
    Object.keys(tx.signatures).length !== 2 ||
    !(wallet in tx.signatures) ||
    !(feePayer in tx.signatures) ||
    wallet === feePayer
  )
    throw new Error("Payment signer binding changed.");
  const [source] = await findAssociatedTokenPda({
    owner: address(wallet),
    mint: address(RESEARCH_ASSET),
    tokenProgram: address(TOKEN_PROGRAM),
  });
  const [destination] = await findAssociatedTokenPda({
    owner: address(RESEARCH_TREASURY),
    mint: address(RESEARCH_ASSET),
    tokenProgram: address(TOKEN_PROGRAM),
  });
  let transfer = 0,
    memo = 0,
    compute = 0;
  for (const ix of message.instructions) {
    const program = message.staticAccounts[ix.programAddressIndex];
    const data = Uint8Array.from(ix.data ?? []),
      accounts = (ix.accountIndices ?? []).map(
        (index) => message.staticAccounts[index],
      );
    if (program === TOKEN_PROGRAM) {
      if (
        ++transfer !== 1 ||
        data.length !== 10 ||
        data[0] !== 12 ||
        data[9] !== 6 ||
        new DataView(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        ).getBigUint64(1, true) !== BigInt(RESEARCH_AMOUNT) ||
        accounts.join(",") !==
          [source, RESEARCH_ASSET, destination, wallet].join(",")
      )
        throw new Error("Payment transfer binding changed.");
    } else if (program === PROMOTION_MEMO_PROGRAM) {
      if (
        ++memo !== 1 ||
        accounts.length ||
        new TextDecoder("utf-8", { fatal: true }).decode(data) !==
          requirements.extra.memo
      )
        throw new Error("Payment resource binding changed.");
    } else if (program === "ComputeBudget111111111111111111111111111111") {
      if (
        ++compute > 2 ||
        accounts.length ||
        !(
          (data.length === 5 &&
            data[0] === 2 &&
            new DataView(data.buffer).getUint32(1, true) <= 40_000) ||
          (data.length === 9 &&
            data[0] === 3 &&
            new DataView(data.buffer).getBigUint64(1, true) <= 10_000n)
        )
      )
        throw new Error("Payment compute limits changed.");
    } else throw new Error("Unexpected payment instruction.");
  }
  if (transfer !== 1 || memo !== 1)
    throw new Error("Incomplete payment binding.");
  const signature = tx.signatures[address(wallet)];
  if (
    signed &&
    (!signature ||
      !(await verifySignature(
        await getPublicKeyFromAddress(address(wallet)),
        signature,
        tx.messageBytes,
      )))
  )
    throw new Error("Payment signature is invalid.");
  const messageHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(tx.messageBytes)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  return { messageHash, transaction: tx };
}
