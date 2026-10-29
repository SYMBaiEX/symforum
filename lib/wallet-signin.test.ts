import { describe, expect, test, vi } from "vitest";
import { walletLoginInput, verifyWalletLogin } from "./human-auth-proof";
import {
  requestWalletProof,
  walletFailureMessage,
  requestMessageProof,
  connectMessageWallet,
  supportsMessageSigning,
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
    ).toContain("internal signing error");
    expect(
      walletFailureMessage(new Error("private provider response"), "Phantom"),
    ).not.toContain("private provider response");
  });
});

describe("explicit connected-wallet message compatibility", () => {
  function connected() {
    const account = {
      address: "11111111111111111111111111111111",
      publicKey: new Uint8Array(32),
      chains: ["solana:mainnet"],
      features: ["solana:signMessage"],
    };
    const connect = vi.fn(async () => ({ accounts: [account] }));
    const signMessage = vi.fn(async ({ message }: { message: Uint8Array }) => [
      { signedMessage: message, signature: new Uint8Array(64) },
    ]);
    return {
      account,
      connect,
      signMessage,
      wallet: {
        name: "Phantom",
        accounts: [account],
        features: {
          "standard:connect": { connect },
          "solana:signMessage": { signMessage },
        },
      },
    };
  }
  test("connection alone never requests a signature", async () => {
    const { wallet, account, signMessage } = connected();
    expect(supportsMessageSigning(wallet)).toBe(true);
    expect(await connectMessageWallet(wallet)).toEqual([account]);
    expect(signMessage).not.toHaveBeenCalled();
  });
  test("does not reconnect an already exposed message-signing account", async () => {
    const { wallet, account, connect, signMessage } = connected();
    connect.mockRejectedValueOnce({
      code: -32603,
      message: "Unexpected error",
    });
    expect(await connectMessageWallet(wallet)).toEqual([account]);
    expect(connect).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
  });
  test("disconnected wallets still connect directly once, with no hidden retries", async () => {
    const { wallet, account, connect } = connected();
    wallet.accounts = [];
    const pending = connectMessageWallet(wallet);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual([account]);
    connect.mockRejectedValueOnce({ code: -32603 });
    await expect(connectMessageWallet(wallet)).rejects.toEqual({
      code: -32603,
    });
    expect(connect).toHaveBeenCalledTimes(2);
  });
  test("exposed incompatible accounts cannot bypass connection or account filtering", async () => {
    const { wallet, account, connect, signMessage } = connected();
    wallet.accounts = [{ ...account, features: [] }];
    connect.mockResolvedValueOnce({ accounts: [{ ...account, features: [] }] });
    await expect(connectMessageWallet(wallet)).rejects.toThrow(
      "No message-signing",
    );
    expect(connect).toHaveBeenCalledTimes(1);
    expect(signMessage).not.toHaveBeenCalled();
  });
  test("signs the exact canonical message synchronously from the explicit click", async () => {
    const { wallet, account, signMessage, connect } = connected();
    const result = requestMessageProof(
      wallet,
      account,
      challenge(),
      location,
      now,
    );
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
    const proof = await result;
    const text = new TextDecoder().decode(signMessage.mock.calls[0][0].message);
    expect(text).toContain(
      `forum.symbaiex.com wants you to sign in with your Solana account:\n${account.address}`,
    );
    expect(text).toContain(`Nonce: ${challenge().nonce}`);
    expect(proof.nonce).toBe(challenge().nonce);
    expect(verifyWalletLogin(challenge().input, proof)).toBe(false); // a fabricated signature still fails the unchanged server check
  });
  test("fails before signing when the selected account changes or challenge expires", () => {
    const { wallet, account, signMessage } = connected();
    wallet.accounts = [];
    expect(() =>
      requestMessageProof(wallet, account, challenge(), location, now),
    ).toThrow("changed");
    wallet.accounts = [account];
    expect(() =>
      requestMessageProof(
        wallet,
        account,
        challenge(),
        location,
        now + 300_000,
      ),
    ).toThrow("expired");
    expect(signMessage).not.toHaveBeenCalled();
  });
  test("rejects altered signed bytes without weakening canonical proof checks", async () => {
    const { wallet, account, signMessage } = connected();
    signMessage.mockResolvedValueOnce([
      { signedMessage: new Uint8Array([1]), signature: new Uint8Array(64) },
    ]);
    await expect(
      requestMessageProof(wallet, account, challenge(), location, now),
    ).rejects.toThrow("changed the sign-in message");
  });
  test("does not automatically retry a cancelled message signature", async () => {
    const { wallet, account, signMessage } = connected();
    signMessage.mockRejectedValueOnce({ code: 4001 });
    await expect(
      requestMessageProof(wallet, account, challenge(), location, now),
    ).rejects.toEqual({ code: 4001 });
    expect(signMessage).toHaveBeenCalledTimes(1);
  });
  test("a real Ed25519 compatibility signature passes the unchanged server verifier", async () => {
    const { wallet, account, signMessage } = connected();
    const keys = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const publicKey = new Uint8Array(
      await crypto.subtle.exportKey("raw", keys.publicKey),
    );
    const alphabet =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let number = publicKey.reduce(
        (value, byte) => value * 256n + BigInt(byte),
        0n,
      ),
      address = "";
    while (number) {
      address = alphabet[Number(number % 58n)] + address;
      number /= 58n;
    }
    for (const byte of publicKey) {
      if (byte) break;
      address = "1" + address;
    }
    account.address = address;
    account.publicKey = publicKey;
    signMessage.mockImplementationOnce(async ({ message }) => [
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
      wallet,
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
