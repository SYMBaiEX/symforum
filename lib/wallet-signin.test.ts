import { describe, expect, test, vi } from "vitest";
import { walletLoginInput, verifyWalletLogin } from "./human-auth-proof";
import {
  requestSiwsProof,
  requestMessageProof,
  walletFailureMessage,
} from "./wallet-signin";

const now = Date.parse("2026-10-29T04:00:00Z");
const location = {
  host: "forum.symbaiex.com",
  origin: "https://forum.symbaiex.com",
};
function challenge() {
  const nonce = "a1b2c3d4e5f6g7h8";
  return {
    nonce,
    input: walletLoginInput({
      origin: location.origin,
      nonce,
      createdAt: now,
      expiresAt: now + 300_000,
      purpose: "login",
    }),
  };
}
function fixture() {
  const account = {
    address: "11111111111111111111111111111111",
    publicKey: new Uint8Array(32),
    chains: ["solana:mainnet"],
    features: ["solana:signMessage"],
  };
  const proof = {
    account,
    signedMessage: new Uint8Array([1, 2, 3]),
    signature: new Uint8Array(64),
  };
  const signIn = vi.fn(async () => proof);
  const signMessage = vi.fn(async (message: Uint8Array) => [
    { signedMessage: message, signature: new Uint8Array(64) },
  ]);
  return { account, proof, signIn, signMessage };
}
describe("SDK SIWS proof boundary", () => {
  test("invokes the SDK action synchronously, before asynchronous preparation", async () => {
    const { signIn } = fixture();
    const issued = challenge();
    const pending = requestSiwsProof(signIn, issued, location, now);
    expect(signIn).toHaveBeenCalledExactlyOnceWith(issued.input);
    expect(await pending).toMatchObject({
      nonce: issued.nonce,
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
  });
  test.each([
    { domain: "www.symbaiex.com" },
    { uri: "https://evil.example/auth/wallet" },
    { nonce: "different123" },
    { nonce: "bad_nonce" },
    { expirationTime: new Date(now + 4_000).toISOString() },
    { expirationTime: "invalid" },
    { issuedAt: new Date(now - 300_001).toISOString() },
    { issuedAt: new Date(now + 60_001).toISOString() },
  ])(
    "rejects invalid/changing challenges before invoking any signature: %j",
    (update) => {
      const { signIn } = fixture();
      const issued = challenge();
      Object.assign(issued.input, update);
      expect(() => requestSiwsProof(signIn, issued, location, now)).toThrow();
      expect(signIn).not.toHaveBeenCalled();
    },
  );
  test("does not retry cancellation or accept absent/malformed proofs", async () => {
    const { signIn, proof } = fixture();
    signIn.mockRejectedValueOnce({ code: 4001 });
    await expect(
      requestSiwsProof(signIn, challenge(), location, now),
    ).rejects.toEqual({ code: 4001 });
    expect(signIn).toHaveBeenCalledTimes(1);
    signIn.mockResolvedValueOnce(undefined as never);
    await expect(
      requestSiwsProof(signIn, challenge(), location, now),
    ).rejects.toThrow("cancelled");
    proof.signature = new Uint8Array(1);
    await expect(
      requestSiwsProof(signIn, challenge(), location, now),
    ).rejects.toThrow("unsupported");
    expect(signIn).toHaveBeenCalledTimes(3);
  });
  test("never displays arbitrary provider details", () => {
    expect(walletFailureMessage({ code: 4001 }, "Phantom")).toContain(
      "cancelled",
    );
    expect(walletFailureMessage({ code: -32002 }, "Phantom")).toContain(
      "already open",
    );
    expect(
      walletFailureMessage(new Error("Unexpected error"), "Phantom"),
    ).toContain("internal signing error");
    expect(
      walletFailureMessage(new Error("private provider response"), "Phantom"),
    ).not.toContain("private provider response");
  });
});
describe("SDK message proof boundary", () => {
  test("signs exact canonical bytes only on the explicit invocation", async () => {
    const { account, signMessage } = fixture();
    const pending = requestMessageProof(
      signMessage,
      account,
      challenge(),
      location,
      now,
    );
    expect(signMessage).toHaveBeenCalledTimes(1);
    const text = new TextDecoder().decode(signMessage.mock.calls[0][0]);
    expect(text).toContain(
      `forum.symbaiex.com wants you to sign in with your Solana account:\n${account.address}`,
    );
    expect(text).toContain(`Nonce: ${challenge().nonce}`);
    expect(verifyWalletLogin(challenge().input, await pending)).toBe(false);
  });
  test("expired challenges never prompt", () => {
    const { account, signMessage } = fixture();
    expect(() =>
      requestMessageProof(
        signMessage,
        account,
        challenge(),
        location,
        now + 300_000,
      ),
    ).toThrow("expired");
    expect(signMessage).not.toHaveBeenCalled();
  });
  test("changed signed bytes fail closed", async () => {
    const { account, signMessage } = fixture();
    signMessage.mockResolvedValueOnce([
      { signedMessage: new Uint8Array([1]), signature: new Uint8Array(64) },
    ]);
    await expect(
      requestMessageProof(signMessage, account, challenge(), location, now),
    ).rejects.toThrow("changed the sign-in message");
  });
  test("cancelled signatures are never retried", async () => {
    const { account, signMessage } = fixture();
    signMessage.mockRejectedValueOnce({ code: 4001 });
    await expect(
      requestMessageProof(signMessage, account, challenge(), location, now),
    ).rejects.toEqual({ code: 4001 });
    expect(signMessage).toHaveBeenCalledTimes(1);
  });
  test("real Ed25519 signatures pass the unchanged server verifier, altered nonces do not", async () => {
    const { account, signMessage } = fixture();
    const keys = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const publicKey = new Uint8Array(
      await crypto.subtle.exportKey("raw", keys.publicKey),
    );
    const alphabet =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let value = publicKey.reduce((n, byte) => n * 256n + BigInt(byte), 0n),
      address = "";
    while (value) {
      address = alphabet[Number(value % 58n)] + address;
      value /= 58n;
    }
    for (const byte of publicKey) {
      if (byte) break;
      address = "1" + address;
    }
    account.address = address;
    account.publicKey = publicKey;
    signMessage.mockImplementationOnce(async (message) => [
      {
        signedMessage: message,
        signature: new Uint8Array(
          await crypto.subtle.sign(
            "Ed25519",
            keys.privateKey,
            new Uint8Array(message).buffer,
          ),
        ),
      },
    ]);
    const issued = challenge();
    const proof = await requestMessageProof(
      signMessage,
      account,
      issued,
      location,
      now,
    );
    expect(verifyWalletLogin(issued.input, proof)).toBe(true);
    expect(
      verifyWalletLogin({ ...issued.input, nonce: "different123" }, proof),
    ).toBe(false);
  });
});
