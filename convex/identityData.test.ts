/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerBetterAuth } from "@convex-dev/better-auth/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import schema from "./schema";
import { api, internal, components } from "./_generated/api";
import { bytesToBase64Url } from "./agentIdentityCrypto";
import { walletLoginInput, verifyWalletLogin } from "../lib/human-auth-proof";
import { createSignInMessage } from "@solana/wallet-standard-util";
import { IDENTITY_MARKER } from "../lib/identity-config";

const modules = import.meta.glob("./**/*.ts");
const issuer = "https://strong-bee-384.convex.site";
function setup() {
  const t = convexTest(schema, modules);
  registerBetterAuth(t);
  registerLimiter(t);
  return t;
}
type Test = ReturnType<typeof setup>;
beforeEach(() => vi.stubEnv("CONVEX_SITE_URL", issuer));
afterEach(() => vi.unstubAllEnvs());
async function authUser(
  t: Test,
  email = "reader@example.com",
  verified = true,
  username?: string,
) {
  const now = Date.now();
  return t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Reader",
          email,
          emailVerified: verified,
          createdAt: now,
          updatedAt: now,
          ...(username ? { username } : {}),
        },
      },
    }),
  );
}
async function authenticated(
  t: Test,
  id: string,
  sessionUserId = id,
  expiresAt = Date.now() + 60_000,
) {
  const session = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: sessionUserId,
          token: crypto.randomUUID(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt,
        },
      },
    }),
  );
  return {
    session,
    client: t.withIdentity({
      issuer,
      subject: id,
      authSystem: IDENTITY_MARKER,
      sessionId: session._id,
    }),
  };
}
function base58(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = bytes.reduce((value, byte) => value * 256n + BigInt(byte), 0n),
    result = "";
  while (number) {
    result = alphabet[Number(number % 58n)] + result;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte) break;
    result = "1" + result;
  }
  return result;
}
async function walletProof(
  challenge: { nonce: string; createdAt: number; expiresAt: number },
  overrides: Partial<ReturnType<typeof walletLoginInput>> = {},
) {
  const keys = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", keys.publicKey),
  );
  const address = base58(publicKey);
  const input = {
    ...walletLoginInput({
      ...challenge,
      origin: "https://forum.symbaiex.com",
      purpose: "login",
    }),
    ...overrides,
  };
  const message = createSignInMessage({ ...input, address });
  return {
    address,
    publicKey: bytesToBase64Url(publicKey),
    signedMessage: bytesToBase64Url(message),
    signature: bytesToBase64Url(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          keys.privateKey,
          new Uint8Array(message),
        ),
      ),
    ),
  };
}
describe("canonical account migration and current sessions", () => {
  async function telegramLogin(t: Test, subject: string, username?: string) {
    const issued = await t.mutation(internal.identityData.nonce, {
      provider: "telegram",
      purpose: "login",
      browserHash: "test-browser",
      origin: "https://www.symbaiex.com",
    });
    return t.mutation(internal.identityData.consumeChallenge, {
      provider: "telegram",
      nonce: issued.nonce,
      browserHash: "test-browser",
      telegramSubject: subject,
      ...(username ? { telegramUsername: username } : {}),
    });
  }
  async function nativeUser(t: Test, id: string) {
    return t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: id }],
      }),
    );
  }
  test("Telegram defaults use the verified handle and a later custom handle is retained", async () => {
    const t = setup();
    const first = await telegramLogin(t, "123456", "Verified_Trader");
    expect(await nativeUser(t, first.authUserId!)).toMatchObject({
      username: "verified_trader",
      emailVerified: false,
    });
    const { client } = await authenticated(t, first.authUserId!);
    const canonical = await client.mutation(
      api.identityData.ensureIdentity,
      {},
    );
    expect(await client.query(api.users.maybeViewer, {})).toMatchObject({
      username: "verified_trader",
      role: "reader",
    });
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: "user",
          where: [{ field: "_id", value: first.authUserId! }],
          update: { username: "custom-reader" },
        },
      }),
    );
    await client.mutation(api.identityData.ensureIdentity, {});
    expect(
      (await telegramLogin(t, "123456", "new_telegram_name")).authUserId,
    ).toBe(first.authUserId);
    expect(await nativeUser(t, first.authUserId!)).toMatchObject({
      username: "custom-reader",
    });
    expect(await client.query(api.users.maybeViewer, {})).toMatchObject({
      _id: canonical.userId,
      username: "custom-reader",
    });
  });
  test("concurrent provider suggestions cannot steal a canonical handle or collide", async () => {
    const t = setup();
    const owner = await t.run((ctx) =>
      ctx.db.insert("users", {
        username: "taken",
        usernameNormalized: "taken",
        role: "owner",
      }),
    );
    const [one, two] = await Promise.all([
      telegramLogin(t, "123", "taken"),
      telegramLogin(t, "456", "taken"),
    ]);
    const a = await nativeUser(t, one.authUserId!),
      b = await nativeUser(t, two.authUserId!);
    expect(a?.username).toMatch(/^taken-/);
    expect(b?.username).toMatch(/^taken-/);
    expect(a?.username).not.toBe(b?.username);
    expect(await t.run((ctx) => ctx.db.get("users", owner))).toMatchObject({
      role: "owner",
      username: "taken",
    });
  });
  test("linking a provider never changes the current account's chosen handle", async () => {
    const t = setup(),
      user = await authUser(t, "reader@example.com", true, "my-name");
    const issued = await t.mutation(internal.identityData.nonce, {
      provider: "telegram",
      purpose: "link",
      browserHash: "browser",
      authUserId: user._id,
      origin: "https://www.symbaiex.com",
    });
    await t.mutation(internal.identityData.consumeChallenge, {
      provider: "telegram",
      nonce: issued.nonce,
      browserHash: "browser",
      authUserId: user._id,
      telegramSubject: "123",
      telegramUsername: "provider-name",
    });
    expect(await nativeUser(t, user._id)).toMatchObject({
      username: "my-name",
    });
  });
  test("older auto-named Telegram profiles receive a default without changing canonical IDs", async () => {
    const t = setup(),
      user = await authUser(t, "123@telegram.symbaiex.invalid", false);
    const { client } = await authenticated(t, user._id);
    const canonical = await client.mutation(
      api.identityData.ensureIdentity,
      {},
    );
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "account",
          data: {
            providerId: "telegram",
            accountId: "123",
            userId: user._id,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      }),
    );
    await telegramLogin(t, "123", "real_handle");
    await client.mutation(api.identityData.ensureIdentity, {});
    expect(await client.query(api.users.maybeViewer, {})).toMatchObject({
      _id: canonical.userId,
      username: "real_handle",
      role: "reader",
    });
  });
  test("an older chosen canonical handle is not overwritten during a default backfill", async () => {
    const t = setup(),
      user = await authUser(t, "123@telegram.symbaiex.invalid", false);
    const canonical = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        username: "legacy-custom",
        usernameNormalized: "legacy-custom",
        usernameSource: "chosen",
        role: "owner",
      });
      await ctx.db.insert("betterAuthIdentityLinks", {
        authUserId: user._id,
        userId: id,
        linkedAt: Date.now(),
      });
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "account",
          data: {
            providerId: "telegram",
            accountId: "123",
            userId: user._id,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
      return id;
    });
    await telegramLogin(t, "123", "provider_default");
    expect((await nativeUser(t, user._id))?.username).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get("users", canonical))).toMatchObject({
      username: "legacy-custom",
      role: "owner",
    });
  });
  test("a unique verified email retains the existing canonical ID and role", async () => {
    const t = setup();
    const old = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Original",
        email: "reader@example.com",
        emailVerificationTime: 1,
        role: "owner",
        username: "original",
        usernameNormalized: "original",
      }),
    );
    const before = await t.run((ctx) => ctx.db.get("users", old));
    const user = await authUser(t);
    const { client } = await authenticated(t, user._id);
    expect(await client.mutation(api.identityData.ensureIdentity, {})).toEqual({
      userId: old,
      created: false,
    });
    expect(await t.run((ctx) => ctx.db.get("users", old))).toEqual(before);
    expect(await client.query(api.users.maybeViewer, {})).toMatchObject({
      _id: old,
      role: "owner",
    });
  });
  test("unverified provider email cannot inherit a verified account", async () => {
    const t = setup();
    const old = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "reader@example.com",
        emailVerificationTime: 1,
        role: "owner",
      }),
    );
    const user = await authUser(t, "reader@example.com", false);
    const { client } = await authenticated(t, user._id);
    const result = await client.mutation(api.identityData.ensureIdentity, {});
    expect(result.userId).not.toBe(old);
    expect(
      await t.run((ctx) => ctx.db.get("users", result.userId)),
    ).toMatchObject({ role: "reader" });
  });
  test("unverified legacy/contact email and duplicate legacy emails fail closed", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("users", { email: "reader@example.com", role: "owner" }),
    );
    const user = await authUser(t);
    const { client } = await authenticated(t, user._id);
    await expect(
      client.mutation(api.identityData.ensureIdentity, {}),
    ).rejects.toThrow(/No accounts were merged/);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "reader@example.com",
        emailVerificationTime: 2,
      }),
    );
    await expect(
      client.mutation(api.identityData.ensureIdentity, {}),
    ).rejects.toThrow(/No accounts were merged/);
  });
  test("human login cannot claim an AI identity or reserved username", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "agent@example.com",
        emailVerificationTime: 1,
        isAgent: true,
      }),
    );
    const agent = await authUser(t, "agent@example.com");
    const { client } = await authenticated(t, agent._id);
    await expect(
      client.mutation(api.identityData.ensureIdentity, {}),
    ).rejects.toThrow(/No accounts were merged/);
    await t.run((ctx) =>
      ctx.db.insert("users", { usernameNormalized: "reserved", role: "admin" }),
    );
    expect(
      await t.query(internal.identityData.handleAvailable, {
        username: "RESERVED",
      }),
    ).toBe(false);
    const reader = await authUser(t, "new@example.com", true, "reserved");
    const other = await authenticated(t, reader._id);
    await expect(
      other.client.mutation(api.identityData.ensureIdentity, {}),
    ).rejects.toThrow(/existing account/);
  });
  test("JWT marker, exact issuer and session-to-user binding are all required", async () => {
    const t = setup(),
      user = await authUser(t),
      other = await authUser(t, "other@example.com");
    const wrongSession = await authenticated(t, user._id, other._id);
    await expect(
      wrongSession.client.mutation(api.identityData.ensureIdentity, {}),
    ).rejects.toThrow(/Sign in/);
    const { session } = await authenticated(t, user._id);
    const wrongIssuer = t.withIdentity({
      issuer: "https://attacker.example",
      subject: user._id,
      authSystem: IDENTITY_MARKER,
      sessionId: session._id,
    });
    await expect(
      wrongIssuer.mutation(api.identityData.ensureIdentity, {}),
    ).rejects.toThrow(/Sign in/);
  });
  test("expired and revoked sessions cannot continue authorizing account access", async () => {
    const t = setup(),
      user = await authUser(t);
    const expired = await authenticated(t, user._id, user._id, Date.now() - 1);
    await expect(
      expired.client.mutation(api.identityData.ensureIdentity, {}),
    ).rejects.toThrow(/Sign in/);
    const { client, session } = await authenticated(t, user._id);
    await client.mutation(api.identityData.ensureIdentity, {});
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: {
          model: "session",
          where: [{ field: "_id", value: session._id }],
        },
      }),
    );
    expect(await client.query(api.users.maybeViewer, {})).toBeNull();
  });
});
describe("Solana and Telegram challenge ownership", () => {
  async function challenge(t: Test) {
    return t.mutation(internal.identityData.nonce, {
      provider: "solana",
      purpose: "login",
      browserHash: "browser",
      origin: "https://forum.symbaiex.com",
    });
  }
  test("valid SIWS creates one native account; replay does not create another", async () => {
    const t = setup(),
      issued = await challenge(t),
      proof = await walletProof(issued);
    expect(
      verifyWalletLogin(
        walletLoginInput({
          ...issued,
          origin: "https://forum.symbaiex.com",
          purpose: "login",
        }),
        proof,
      ),
    ).toBe(true);
    const args = {
      ...proof,
      nonce: issued.nonce,
      browserHash: "browser",
      provider: "solana" as const,
    };
    const result = await t.mutation(
      internal.identityData.consumeChallenge,
      args,
    );
    expect(result.purpose).toBe("login");
    expect(result.authUserId).toBeTruthy();
    await expect(
      t.mutation(internal.identityData.consumeChallenge, args),
    ).rejects.toThrow(/expired/);
  });
  test("wrong browser, chain, domain, purpose and signature are rejected without consuming a good challenge", async () => {
    const t = setup(),
      issued = await challenge(t),
      proof = await walletProof(issued);
    await expect(
      t.mutation(internal.identityData.consumeChallenge, {
        ...proof,
        nonce: issued.nonce,
        browserHash: "other",
        provider: "solana",
      }),
    ).rejects.toThrow(/expired/);
    const wrong = await walletProof(issued, { domain: "attacker.example" });
    await expect(
      t.mutation(internal.identityData.consumeChallenge, {
        ...wrong,
        nonce: issued.nonce,
        browserHash: "browser",
        provider: "solana",
      }),
    ).rejects.toThrow(/signature/);
    const input = walletLoginInput({
      ...issued,
      origin: "https://forum.symbaiex.com",
      purpose: "login",
    });
    expect(
      verifyWalletLogin({ ...input, chainId: "solana:devnet" }, proof),
    ).toBe(false);
    expect(
      verifyWalletLogin({ ...input, statement: "Link this account" }, proof),
    ).toBe(false);
    expect(
      verifyWalletLogin(input, {
        ...proof,
        signature: proof.signature.slice(1),
      }),
    ).toBe(false);
    await expect(
      t.mutation(internal.identityData.consumeChallenge, {
        ...proof,
        nonce: issued.nonce,
        browserHash: "browser",
        provider: "solana",
      }),
    ).resolves.toMatchObject({ purpose: "login" });
  });
  test("expired proof and untrusted origin are denied", async () => {
    const t = setup(),
      issued = await challenge(t),
      proof = await walletProof(issued);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("identityChallenges")
        .withIndex("by_nonce", (q) => q.eq("nonce", issued.nonce))
        .unique();
      await ctx.db.patch("identityChallenges", row!._id, {
        expiresAt: Date.now() - 1,
      });
    });
    await expect(
      t.mutation(internal.identityData.consumeChallenge, {
        ...proof,
        nonce: issued.nonce,
        browserHash: "browser",
        provider: "solana",
      }),
    ).rejects.toThrow(/expired/);
    await expect(
      t.mutation(internal.identityData.nonce, {
        provider: "solana",
        purpose: "login",
        browserHash: "browser",
        origin: "https://evil.symbaiex.com",
      }),
    ).rejects.toThrow(/Invalid/);
  });
  test("a Telegram identity cannot be linked to two native accounts", async () => {
    const t = setup(),
      first = await authUser(t),
      second = await authUser(t, "second@example.com");
    async function link(authUserId: string) {
      const issued = await t.mutation(internal.identityData.nonce, {
        provider: "telegram",
        purpose: "link",
        browserHash: authUserId,
        authUserId,
        origin: "https://forum.symbaiex.com",
      });
      return t.mutation(internal.identityData.consumeChallenge, {
        provider: "telegram",
        nonce: issued.nonce,
        browserHash: authUserId,
        authUserId,
        telegramSubject: "123456789",
      });
    }
    await expect(link(first._id)).resolves.toMatchObject({
      authUserId: first._id,
    });
    await expect(link(second._id)).rejects.toThrow(/another account/);
  });
  test("link proof cannot be moved to another signed-in account", async () => {
    const t = setup(),
      user = await authUser(t);
    const issued = await t.mutation(internal.identityData.nonce, {
      provider: "telegram",
      purpose: "link",
      browserHash: "binder",
      authUserId: user._id,
      origin: "https://www.symbaiex.com",
    });
    await expect(
      t.mutation(internal.identityData.consumeChallenge, {
        provider: "telegram",
        nonce: issued.nonce,
        browserHash: "binder",
        authUserId: "other",
        telegramSubject: "123",
      }),
    ).rejects.toThrow(/Account changed/);
  });
  test("atomic unlink cannot remove the final account even through parallel requests", async () => {
    const t = setup(),
      user = await authUser(t);
    for (const providerId of ["solana", "telegram"])
      await t.run((ctx) =>
        ctx.runMutation(components.betterAuth.adapter.create, {
          input: {
            model: "account",
            data: {
              userId: user._id,
              providerId,
              accountId: providerId,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
        }),
      );
    const result = await Promise.allSettled(
      ["solana", "telegram"].map((providerId) =>
        t.mutation(internal.identityData.unlinkAccount, {
          authUserId: user._id,
          providerId,
          accountId: providerId,
        }),
      ),
    );
    expect(result.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    const remaining = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "account",
        where: [{ field: "userId", value: user._id }],
        paginationOpts: { numItems: 2, cursor: null },
      }),
    );
    expect(remaining.page).toHaveLength(1);
  });
  test("recovery mail excludes internal aliases and has a persistent per-address cap", async () => {
    const t = setup();
    expect(
      await t.mutation(internal.identityData.reserveEmail, {
        email: "wallet@solana.symbaiex.invalid",
      }),
    ).toBe(false);
    for (let i = 0; i < 3; i++)
      expect(
        await t.mutation(internal.identityData.reserveEmail, {
          email: "person@example.com",
        }),
      ).toBe(true);
    expect(
      await t.mutation(internal.identityData.reserveEmail, {
        email: "person@example.com",
      }),
    ).toBe(false);
  });
});
