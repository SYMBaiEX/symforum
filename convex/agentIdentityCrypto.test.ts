import { expect, test, vi } from "vitest";
import {
  buildAgentLoginMessage,
  bytesToBase64Url,
  validateEd25519PublicKey,
  verifyEd25519Signature,
} from "./agentIdentityCrypto";

const message = buildAgentLoginMessage({
  agentId: "test-agent",
  audience: "https://www.symbaiex.com/api/agent/mcp",
  challenge: "unchanged-test-challenge",
  expiresAt: 1_800_000_000_000,
});

async function fixture() {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return {
    publicKey: bytesToBase64Url(
      new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    ),
    signature: bytesToBase64Url(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          pair.privateKey,
          new TextEncoder().encode(message),
        ),
      ),
    ),
    message,
  };
}

test("strict verification accepts genuine agent signatures and binds the exact challenge", async () => {
  const signed = await fixture();
  expect(validateEd25519PublicKey(signed.publicKey)).toBe(true);
  await expect(verifyEd25519Signature(signed)).resolves.toBe(true);
  await expect(
    verifyEd25519Signature({ ...signed, message: `${message}!` }),
  ).resolves.toBe(false);
});

test.each(["public key", "signature R"] as const)(
  "rejects small-order %s even when host verification is permissive",
  async (smallOrderPart) => {
    const signed = await fixture();
    const identity = new Uint8Array(32);
    identity[0] = 1;
    const forged = new Uint8Array(64);
    forged.set(
      smallOrderPart === "signature R"
        ? identity
        : new Uint8Array(32).fill(2),
    );
    const verify = vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true);
    try {
      const publicKey =
        smallOrderPart === "public key"
          ? bytesToBase64Url(identity)
          : signed.publicKey;
      // Keep stored public-key syntax/length validation unchanged.
      expect(validateEd25519PublicKey(publicKey)).toBe(true);
      await expect(
        verifyEd25519Signature({
          ...signed,
          publicKey,
          signature: bytesToBase64Url(forged),
        }),
      ).resolves.toBe(false);
      expect(verify).not.toHaveBeenCalled();
    } finally {
      verify.mockRestore();
    }
  },
);

test("invalid signature encodings and lengths still fail closed", async () => {
  const signed = await fixture();
  for (const change of [
    { publicKey: "not+base64url" },
    { publicKey: bytesToBase64Url(new Uint8Array(31)) },
    { signature: "not/base64url" },
    { signature: bytesToBase64Url(new Uint8Array(63)) },
    { signature: bytesToBase64Url(new Uint8Array(64).fill(1)) },
  ]) {
    await expect(
      verifyEd25519Signature({ ...signed, ...change }),
    ).resolves.toBe(false);
  }
});

test("unavailable cryptography returns false without exposing provider errors", async () => {
  const signed = await fixture();
  const exportKey = vi
    .spyOn(crypto.subtle, "exportKey")
    .mockRejectedValueOnce(new Error("private host exception"));
  try {
    await expect(verifyEd25519Signature(signed)).resolves.toBe(false);
  } finally {
    exportKey.mockRestore();
  }
});
