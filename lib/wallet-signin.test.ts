import { describe, expect, test, vi } from "vitest";
import { walletLoginInput } from "./human-auth-proof";
import { requestWalletProof, walletFailureMessage } from "./wallet-signin";

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
  const proof = {
    account: {
      address: "11111111111111111111111111111111",
      publicKey: new Uint8Array(32),
    },
    signedMessage: new Uint8Array([1, 2, 3]),
    signature: new Uint8Array(64),
  };
  const signIn = vi.fn(async () => [proof]);
  return {
    proof,
    signIn,
    wallet: { name: "Phantom", features: { "solana:signIn": { signIn } } },
  };
}

describe("Wallet Standard sign-in", () => {
  test("calls the wallet synchronously, before any asynchronous work", async () => {
    const { wallet, signIn } = fixture();
    const issued = challenge();
    const result = requestWalletProof(wallet, issued, location, now);
    expect(signIn).toHaveBeenCalledExactlyOnceWith(issued.input);
    expect(await result).toMatchObject({
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
    "rejects a changed, expired or invalid challenge without prompting: %j",
    (update) => {
      const { wallet, signIn } = fixture();
      const issued = challenge();
      Object.assign(issued.input, update);
      expect(() => requestWalletProof(wallet, issued, location, now)).toThrow();
      expect(signIn).not.toHaveBeenCalled();
    },
  );

  test("does not use the Ethereum provider", async () => {
    const { wallet } = fixture();
    const hostile = Object.defineProperty({ ...location }, "ethereum", {
      get() {
        throw new Error("Ethereum must not be accessed");
      },
    });
    await expect(
      requestWalletProof(wallet, challenge(), hostile, now),
    ).resolves.toBeDefined();
  });

  test("handles rejection, cancellation and malformed proofs without retrying signing", async () => {
    const { wallet, signIn, proof } = fixture();
    signIn.mockRejectedValueOnce({ code: 4001 });
    await expect(
      requestWalletProof(wallet, challenge(), location, now),
    ).rejects.toEqual({ code: 4001 });
    expect(signIn).toHaveBeenCalledTimes(1);
    signIn.mockResolvedValueOnce([]);
    await expect(
      requestWalletProof(wallet, challenge(), location, now),
    ).rejects.toThrow("cancelled");
    proof.signature = new Uint8Array(1);
    await expect(
      requestWalletProof(wallet, challenge(), location, now),
    ).rejects.toThrow("unsupported");
    expect(signIn).toHaveBeenCalledTimes(3);
  });

  test("maps safe wallet errors without exposing arbitrary provider details", () => {
    expect(walletFailureMessage({ code: 4001 }, "Phantom")).toContain(
      "cancelled",
    );
    expect(walletFailureMessage({ code: -32002 }, "Phantom")).toContain(
      "already open",
    );
    expect(
      walletFailureMessage(new Error("Unexpected error"), "Phantom"),
    ).toContain("Unlock");
    expect(
      walletFailureMessage(new Error("private provider response"), "Phantom"),
    ).not.toContain("private provider response");
  });
});
