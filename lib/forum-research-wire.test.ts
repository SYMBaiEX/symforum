import { expect, test } from "vitest";
import {
  address,
  blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  appendTransactionMessageInstructions,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { inspectResearchWire } from "./forum-research-wire";
import {
  RESEARCH_ASSET,
  RESEARCH_TREASURY,
  researchRequirements,
} from "./forum-research";
import { PROMOTION_MEMO_PROGRAM, TOKEN_PROGRAM } from "./forum-commerce";

/** Ephemeral unfunded keys; fixture signs bytes locally only, never accesses RPC. */
async function fixture(
  change: "amount" | "memo" | "destination" | "extra" | null = null,
) {
  const keys = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const wallet = getAddressDecoder().decode(
    new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)),
  );
  const feePayer = address("So11111111111111111111111111111111111111112"),
    requirements = researchRequirements("a".repeat(64), feePayer);
  const [source] = await findAssociatedTokenPda({
    owner: wallet,
    mint: address(RESEARCH_ASSET),
    tokenProgram: address(TOKEN_PROGRAM),
  });
  const [destination] = await findAssociatedTokenPda({
    owner: address(RESEARCH_TREASURY),
    mint: address(RESEARCH_ASSET),
    tokenProgram: address(TOKEN_PROGRAM),
  });
  const instructions: Instruction[] = [
    getTransferCheckedInstruction({
      source,
      mint: address(RESEARCH_ASSET),
      destination: change === "destination" ? source : destination,
      authority: createNoopSigner(wallet),
      amount: change === "amount" ? 1n : 100000n,
      decimals: 6,
    }),
    {
      programAddress: address(PROMOTION_MEMO_PROGRAM),
      accounts: [],
      data: new TextEncoder().encode(
        change === "memo" ? "other" : String(requirements.extra.memo),
      ),
    },
  ];
  if (change === "extra")
    instructions.push({
      programAddress: address("11111111111111111111111111111111"),
      accounts: [],
      data: new Uint8Array(0),
    });
  const tx = compileTransaction(
    setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: blockhash("11111111111111111111111111111111"),
        lastValidBlockHeight: 100n,
      },
      setTransactionMessageFeePayer(
        feePayer,
        appendTransactionMessageInstructions(
          instructions,
          createTransactionMessage({ version: 0 }),
        ),
      ),
    ),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      keys.privateKey,
      Uint8Array.from(tx.messageBytes),
    ),
  );
  const signed = {
    ...tx,
    signatures: { ...tx.signatures, [wallet]: signature },
  } as Parameters<typeof getBase64EncodedWireTransaction>[0];
  return {
    wallet,
    requirements,
    wire: getBase64EncodedWireTransaction(tx),
    signedWire: getBase64EncodedWireTransaction(signed),
  };
}
test("exact two-signer x402 transfer/memo binds simulated and wallet-signed bytes", async () => {
  const value = await fixture();
  const unsigned = await inspectResearchWire(
    value.wire,
    value.wallet,
    value.requirements,
    false,
  );
  const signed = await inspectResearchWire(
    value.signedWire,
    value.wallet,
    value.requirements,
    true,
  );
  expect(unsigned.messageHash).toBe(signed.messageHash);
  await expect(
    inspectResearchWire(value.wire, value.wallet, value.requirements, true),
  ).rejects.toThrow("signature");
});
test.each(["amount", "memo", "destination", "extra"] as const)(
  "rejects substituted %s even when the wallet signed it",
  async (change) => {
    const value = await fixture(change);
    await expect(
      inspectResearchWire(
        value.signedWire,
        value.wallet,
        value.requirements,
        true,
      ),
    ).rejects.toThrow();
  },
);
