import { expect, test, vi } from "vitest";
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
import { inspectSignedSwap, signedBytesToBase64 } from "./swap-signed-wire";
import { signedSwapFixture } from "../tests/fixtures/signed-swap";
test.each([0, 1] as const)(
  "verifies an exact real Ed25519 signature for v%s without network IO",
  async (version) => {
    const f = await signedSwapFixture(version);
    expect(
      await inspectSignedSwap(f.signedTransactionBase64, f.prepared),
    ).toMatchObject({
      signature: expect.any(String),
      wireHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      messageHash: f.prepared.messageHash,
    });
  },
);
test("rejects altered bytes, wrong message/payer/version and forged signatures", async () => {
  const f = await signedSwapFixture(),
    other = await signedSwapFixture();
  for (const binding of [
    { ...f.prepared, messageHash: "0".repeat(64) },
    { ...f.prepared, wallet: other.wallet },
    { ...f.prepared, transactionVersion: 0 },
  ])
    await expect(
      inspectSignedSwap(f.signedTransactionBase64, binding),
    ).rejects.toThrow();
  const forged = getBase64EncodedWireTransaction({
    ...f.transaction,
    signatures: { [f.wallet]: new Uint8Array(64).fill(1) },
  } as unknown as Parameters<typeof getBase64EncodedWireTransaction>[0]);
  await expect(inspectSignedSwap(forged, f.prepared)).rejects.toThrow(
    "Invalid transaction signature",
  );
  await expect(
    inspectSignedSwap(f.prepared.transactionBase64, f.prepared),
  ).rejects.toThrow();
  await expect(
    inspectSignedSwap(f.signedTransactionBase64 + "AAAA", f.prepared),
  ).rejects.toThrow();
});
test("fixed diagnostics distinguish message, payer, version, missing and invalid signatures without weakening rejection", async () => {
  const f = await signedSwapFixture(),
    other = await signedSwapFixture();
  for (const [binding, issue] of [
    [{ ...f.prepared, messageHash: "0".repeat(64) }, "message_mismatch"],
    [{ ...f.prepared, wallet: other.wallet }, "payer_mismatch"],
    [{ ...f.prepared, transactionVersion: 0 }, "version_mismatch"],
  ] as const) {
    await expect(
      inspectSignedSwap(f.signedTransactionBase64, binding),
    ).rejects.toMatchObject({ issue });
  }
  await expect(
    inspectSignedSwap(f.prepared.transactionBase64, f.prepared),
  ).rejects.toMatchObject({ issue: "signature_missing" });
  const forged = getBase64EncodedWireTransaction({
    ...f.transaction,
    signatures: { [f.wallet]: new Uint8Array(64).fill(1) },
  } as unknown as Parameters<typeof getBase64EncodedWireTransaction>[0]);
  await expect(inspectSignedSwap(forged, f.prepared)).rejects.toMatchObject({
    issue: "invalid_signature",
  });
  await expect(inspectSignedSwap("!!", f.prepared)).rejects.toMatchObject({
    issue: "wire_format",
  });
});
test("unavailable browser verification fails closed with no raw exception leakage", async () => {
  const f = await signedSwapFixture();
  const spy = vi
    .spyOn(crypto.subtle, "importKey")
    .mockRejectedValueOnce(new Error("private crypto exception"));
  try {
    await expect(
      inspectSignedSwap(f.signedTransactionBase64, f.prepared),
    ).rejects.toMatchObject({
      issue: "crypto_unavailable",
      message: "Signature verification is unavailable.",
    });
  } finally {
    spy.mockRestore();
  }
});
test.each(["public key", "signature R"] as const)(
  "rejects a forged small-order %s even with permissive WebCrypto",
  async (smallOrderPart) => {
    const f = await signedSwapFixture();
    // Identity-point encoding. Such keys/signature R values must never pass
    // Solana's strict verifier, regardless of the host's Ed25519 implementation.
    const identity = new Uint8Array(32);
    identity[0] = 1;
    const wallet =
      smallOrderPart === "public key"
        ? getAddressDecoder().decode(identity)
        : f.wallet;
    const transaction = compileTransaction(
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash("11111111111111111111111111111111"),
          lastValidBlockHeight: 100n,
        },
        setTransactionMessageFeePayer(
          address(wallet),
          createTransactionMessage({ version: 1 }),
        ),
      ),
    );
    const forgedSignature = new Uint8Array(64);
    // Keep the other point non-small-order to isolate each strictness check.
    forgedSignature.set(
      smallOrderPart === "signature R" ? identity : new Uint8Array(32).fill(2),
    );
    const wire = getBase64EncodedWireTransaction({
      ...transaction,
      signatures: { [wallet]: forgedSignature },
    } as unknown as Parameters<typeof getBase64EncodedWireTransaction>[0]);
    const messageHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          Uint8Array.from(transaction.messageBytes),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    // Reproduce a host that accepts weak signatures: Kit must reject them
    // before delegating to the underlying WebCrypto verifier.
    const verify = vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true);
    try {
      await expect(
        inspectSignedSwap(wire, {
          wallet,
          messageHash,
          transactionVersion: 1,
        }),
      ).rejects.toMatchObject({ issue: "invalid_signature" });
      expect(verify).not.toHaveBeenCalled();
    } finally {
      verify.mockRestore();
    }
  },
);
test("unavailable key export fails closed with its existing safe category", async () => {
  const f = await signedSwapFixture();
  const spy = vi
    .spyOn(crypto.subtle, "exportKey")
    .mockRejectedValueOnce(new Error("private key export exception"));
  try {
    await expect(
      inspectSignedSwap(f.signedTransactionBase64, f.prepared),
    ).rejects.toMatchObject({
      issue: "crypto_unavailable",
      message: "Signature verification is unavailable.",
    });
  } finally {
    spy.mockRestore();
  }
});
test.each([
  new Uint16Array(100),
  new DataView(new ArrayBuffer(100)),
  new Uint8Array(5000),
  "provider body",
])("rejects invalid signed wire responses", (value) => {
  expect(() => signedBytesToBase64(value)).toThrow();
});
