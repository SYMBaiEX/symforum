import { expect, test } from "vitest";
import { getBase64EncodedWireTransaction } from "@solana/kit";
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
test.each([
  new Uint16Array(100),
  new DataView(new ArrayBuffer(100)),
  new Uint8Array(5000),
  "provider body",
])("rejects invalid signed wire responses", (value) => {
  expect(() => signedBytesToBase64(value)).toThrow();
});
