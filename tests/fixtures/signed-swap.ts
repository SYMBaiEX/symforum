import {
  address,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
/** Ephemeral unfunded test keys. No key material is saved or sent anywhere. */
export async function signedSwapFixture(version: 0 | 1 = 1) {
  const key = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const wallet = getAddressDecoder().decode(
    new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey)),
  );
  const transaction = compileTransaction(
    setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: blockhash("11111111111111111111111111111111"),
        lastValidBlockHeight: 100n,
      },
      setTransactionMessageFeePayer(
        address(wallet),
        version === 1
          ? createTransactionMessage({ version: 1 })
          : createTransactionMessage({ version: 0 }),
      ),
    ),
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      key.privateKey,
      Uint8Array.from(transaction.messageBytes),
    ),
  );
  const wire = getBase64EncodedWireTransaction({
    ...transaction,
    signatures: { [wallet]: bytes },
  } as unknown as Parameters<typeof getBase64EncodedWireTransaction>[0]);
  const messageHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        Uint8Array.from(transaction.messageBytes),
      ),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return {
    wallet,
    signedTransactionBase64: wire,
    transaction,
    prepared: {
      wallet,
      messageHash,
      transactionBase64: getBase64EncodedWireTransaction(transaction),
      transactionVersion: version,
      simulationSlot: 200,
      lastValidBlockHeight: 100,
      estimatedNetworkFeeLamports: "5000",
    },
  };
}
