/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerBetterAuth } from "@convex-dev/better-auth/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import schema from "./schema";
import { components } from "./_generated/api";
import { api } from "./_generated/api";
import { Password } from "@convex-dev/auth/providers/Password";
import { createIdentityAuth } from "./identity";
import { bytesToBase64Url } from "./agentIdentityCrypto";
import { createSignInMessage } from "@solana/wallet-standard-util";
import { createLocalJWKSet, jwtVerify } from "jose";
const mail = vi.hoisted(() => ({
  messages: [] as { text: string; to: string }[],
}));
vi.mock("./resendClient", () => ({
  resend: {
    sendEmail: vi.fn(async (_ctx, message) => {
      mail.messages.push(message);
      return "test-only";
    }),
  },
}));
const modules = import.meta.glob("./**/*.ts");
function setup() {
  const t = convexTest(schema, modules);
  registerBetterAuth(t);
  registerLimiter(t);
  return t;
}
type Test = ReturnType<typeof setup>;
beforeEach(() => {
  mail.messages.length = 0;
  vi.stubEnv("CONVEX_SITE_URL", "https://strong-bee-384.convex.site");
  vi.stubEnv("BETTER_AUTH_ENABLED", "true");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "isolated-test-secret-never-used-in-production-identity",
  );
  vi.stubEnv("IDENTITY_SITE_URL", "https://www.symbaiex.com");
  vi.stubEnv(
    "BETTER_AUTH_GOOGLE_CLIENT_ID",
    "isolated-test.apps.googleusercontent.com",
  );
  vi.stubEnv("BETTER_AUTH_GOOGLE_CLIENT_SECRET", "isolated-test-only");
});
afterEach(() => vi.unstubAllEnvs());
function request(
  t: Test,
  path: string,
  body?: unknown,
  cookie?: string,
  host = "www.symbaiex.com",
  origin = "https://" + host,
) {
  return t.fetch("/api/identity" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-better-auth-forwarded-host": host,
      "x-better-auth-forwarded-proto": "https",
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
async function signedIn(t: Test) {
  const sent = await request(t, "/email-otp/send-verification-otp", {
    email: "reader@example.com",
    type: "sign-in",
  });
  expect(sent.status).toBe(200);
  expect(mail.messages).toHaveLength(1);
  const otp = mail.messages[0].text.match(/\b(\d{6})\b/)![1];
  const verify = await request(t, "/sign-in/email-otp", {
    email: "reader@example.com",
    otp,
  });
  expect(verify.status).toBe(200);
  const cookie = cookies(verify);
  expect(
    (await request(t, "/update-user", { username: "newreader" }, cookie))
      .status,
  ).toBe(200);
  expect(
    (
      await request(
        t,
        "/identity/password",
        { password: "correct-test-password-123" },
        cookie,
      )
    ).status,
  ).toBe(200);
  const login = await request(t, "/sign-in/username", {
    username: "newreader",
    password: "correct-test-password-123",
  });
  expect(login.status).toBe(200);
  return { cookie: cookies(login), response: login };
}
test("a password cannot be pre-registered before proving ownership of the email", async () => {
  const response = await request(setup(), "/sign-up/email", {
    name: "Pre-claim",
    email: "victim@example.com",
    password: "attacker-chosen-password",
  });
  expect(response.status).toBe(400);
  expect(mail.messages).toHaveLength(0);
});
test("patched discovery exposes only the fixed issuer and public JWKS location", async () => {
  const response = await request(
    setup(),
    "/convex/.well-known/openid-configuration",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    issuer: "https://strong-bee-384.convex.site",
    jwks_uri: "https://strong-bee-384.convex.site/api/identity/convex/jwks",
    id_token_signing_alg_values_supported: ["RS256"],
  });
});
test("1.7 atomic fallbacks consume a proof once and preserve concurrent increments", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    const now = Date.now();
    await adapter.create({
      model: "verification",
      data: {
        identifier: "one-use-test",
        value: "test-only",
        expiresAt: new Date(now + 60000),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    });
    const consumed = await Promise.all(
      [0, 1].map(() =>
        adapter.consumeOne({
          model: "verification",
          where: [{ field: "identifier", value: "one-use-test" }],
        }),
      ),
    );
    expect(consumed.filter(Boolean)).toHaveLength(1);
    await adapter.create({
      model: "rateLimit",
      data: { key: "atomic-counter-test", count: 0, lastRequest: now },
    });
    const incremented = await Promise.all(
      [0, 1, 2, 3].map(() =>
        adapter.incrementOne({
          model: "rateLimit",
          where: [
            { field: "key", value: "atomic-counter-test" },
            { field: "count", operator: "lt", value: 2 },
          ],
          increment: { count: 1 },
        }),
      ),
    );
    expect(incremented.filter(Boolean)).toHaveLength(2);
    expect(
      await adapter.findOne({
        model: "rateLimit",
        where: [{ field: "key", value: "atomic-counter-test" }],
      }),
    ).toMatchObject({ count: 2 });
    return null;
  });
});
test("parallel rate-limit key creation leaves exactly one authoritative row", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        adapter.create({
          model: "rateLimit",
          data: {
            key: "racing-new-limit",
            count: 1,
            lastRequest: Date.now(),
          },
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await adapter.findMany({
        model: "rateLimit",
        where: [{ field: "key", value: "racing-new-limit" }],
      }),
    ).toHaveLength(1);
    return null;
  });
});
test("a signed wallet proof creates a native session and verifiable JWT, never a transaction", async () => {
  const t = setup();
  const issued = await request(
    t,
    "/identity/challenge",
    { provider: "solana", purpose: "login" },
    undefined,
    "forum.symbaiex.com",
  );
  expect(issued.status).toBe(200);
  const challenge = await issued.json();
  const keys = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keys.publicKey),
  );
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = raw.reduce((value, byte) => value * 256n + BigInt(byte), 0n),
    address = "";
  while (number) {
    address = alphabet[Number(number % 58n)] + address;
    number /= 58n;
  }
  for (const byte of raw) {
    if (byte) break;
    address = "1" + address;
  }
  const message = createSignInMessage({ ...challenge.input, address });
  const proof = {
    nonce: challenge.nonce,
    address,
    publicKey: bytesToBase64Url(raw),
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
  const loggedIn = await request(
    t,
    "/sign-in/solana",
    proof,
    cookies(issued),
    "forum.symbaiex.com",
  );
  expect(loggedIn.status).toBe(200);
  const cookie = cookies(loggedIn);
  const tokenResponse = await request(t, "/convex/token", undefined, cookie);
  expect(tokenResponse.status).toBe(200);
  const { token } = await tokenResponse.json();
  const publicKeys = await (await request(t, "/convex/jwks")).json();
  for (const key of publicKeys.keys) expect(key).not.toHaveProperty("d");
  const { payload } = await jwtVerify(token, createLocalJWKSet(publicKeys), {
    issuer: "https://strong-bee-384.convex.site",
    audience: "convex",
    algorithms: ["RS256"],
  });
  expect(payload.authSystem).toBe("symbaiex-human-v1");
  expect(payload.sessionId).toEqual(expect.any(String));
  expect(Number(payload.exp) - Number(payload.iat)).toBe(300);
  for (const host of [
    "www.symbaiex.com",
    "forum.symbaiex.com",
    "blog.symbaiex.com",
    "news.symbaiex.com",
    "newsletter.symbaiex.com",
  ]) {
    expect(
      await (await request(t, "/get-session", undefined, cookie, host)).json(),
    ).toMatchObject({ user: { id: payload.sub } });
  }
  expect(
    (
      await request(
        t,
        "/sign-in/solana",
        proof,
        cookies(issued),
        "forum.symbaiex.com",
      )
    ).status,
  ).not.toBe(200);
  expect(
    (await request(t, "/sign-out", {}, cookie, "forum.symbaiex.com")).status,
  ).toBe(200);
  expect(
    await (await request(t, "/get-session", undefined, cookie)).json(),
  ).toBeNull();
});
test("unused Magic Link, OAuth Proxy, device and key-administration routes are not public", async () => {
  const t = setup();
  for (const path of [
    "/magic-link/verify?token=test",
    "/oauth-proxy-callback",
    "/device/code",
    "/oauth2/authorize",
    "/convex/latest-jwks",
    "/convex/rotate-keys",
  ]) {
    const response = await request(
      t,
      path,
      path.includes("jwks") ||
        path.includes("rotate") ||
        path.includes("device")
        ? {}
        : undefined,
    );
    expect(response.status).toBe(404);
  }
});
test("raw Google ID-token shortcuts cannot bypass the server-bound redirect flow", async () => {
  const response = await request(setup(), "/sign-in/social", {
    provider: "google",
    idToken: { token: "untrusted" },
  });
  expect(response.status).toBe(400);
});
test("verified email/username login shares a secure native session across apps and logout revokes it", async () => {
  const t = setup(),
    { cookie, response } = await signedIn(t);
  expect(response.headers.getSetCookie().join(";")).toMatch(/HttpOnly/i);
  expect(response.headers.getSetCookie().join(";")).toMatch(/Secure/i);
  expect(response.headers.getSetCookie().join(";")).toMatch(
    /Domain=\.symbaiex\.com/i,
  );
  expect(response.headers.getSetCookie().join(";")).toMatch(/SameSite=Lax/i);
  const forum = await request(
    t,
    "/get-session",
    undefined,
    cookie,
    "forum.symbaiex.com",
  );
  expect(forum.status).toBe(200);
  const session = await forum.json();
  expect(session.user.username).toBe("newreader");
  const logout = await request(
    t,
    "/sign-out",
    {},
    cookie,
    "forum.symbaiex.com",
  );
  expect(logout.status).toBe(200);
  for (const host of [
    "www.symbaiex.com",
    "forum.symbaiex.com",
    "blog.symbaiex.com",
    "news.symbaiex.com",
    "newsletter.symbaiex.com",
  ]) {
    expect(
      await (await request(t, "/get-session", undefined, cookie, host)).json(),
    ).toBeNull();
  }
});
test("Google authorization uses the first-party callback and retains provider state", async () => {
  const t = setup();
  const response = await request(t, "/sign-in/social", {
    provider: "google",
    callbackURL: "https://forum.symbaiex.com/account/connections",
  });
  expect(response.status).toBe(200);
  const data = await response.json();
  const url = new URL(data.url);
  expect(url.hostname).toBe("accounts.google.com");
  expect(url.searchParams.get("redirect_uri")).toBe(
    "https://www.symbaiex.com/api/identity/callback/google",
  );
  expect(url.searchParams.get("state")).toBeTruthy();
});
test("expired fresh-auth window cannot link or unlink identities", async () => {
  const t = setup(),
    { cookie } = await signedIn(t);
  const session = await (
    await request(t, "/get-session", undefined, cookie)
  ).json();
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "session",
        where: [{ field: "_id", value: session.session.id }],
        update: { createdAt: Date.now() - 600_000 },
      },
    }),
  );
  expect(
    (
      await request(
        t,
        "/identity/challenge",
        { provider: "solana", purpose: "link" },
        cookie,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await request(
        t,
        "/identity/unlink",
        { providerId: "credential", accountId: session.user.id },
        cookie,
      )
    ).status,
  ).toBe(401);
});
test("cross-origin requests and forged Telegram proofs never create an identity", async () => {
  const t = setup();
  const foreign = await request(
    t,
    "/identity/challenge",
    { provider: "solana", purpose: "login" },
    undefined,
    "www.symbaiex.com",
    "https://attacker.example",
  );
  expect(foreign.status).toBe(403);
  vi.stubEnv("TELEGRAM_LOGIN_CLIENT_ID", "123456789");
  const challenge = await request(t, "/identity/challenge", {
    provider: "telegram",
    purpose: "login",
  });
  expect(challenge.status).toBe(200);
  const data = await challenge.json();
  const forged = await request(
    t,
    "/sign-in/telegram",
    { nonce: data.nonce, idToken: "not-a-valid-token" },
    cookies(challenge),
  );
  expect(forged.status).toBe(401);
});
test("last sign-in credential cannot be unlinked, and a disabled cutover is closed", async () => {
  const t = setup(),
    { cookie } = await signedIn(t);
  const session = await (
    await request(t, "/get-session", undefined, cookie)
  ).json();
  expect(
    (
      await request(
        t,
        "/identity/unlink",
        { providerId: "credential", accountId: session.user.id },
        cookie,
      )
    ).status,
  ).toBe(400);
  vi.stubEnv("BETTER_AUTH_ENABLED", "false");
  expect(
    (
      await request(t, "/identity/challenge", {
        provider: "solana",
        purpose: "login",
      })
    ).status,
  ).toBe(404);
});
test("legacy password migration retains the user ID and role, retires the old verifier, and permits current username login", async () => {
  const t = setup(),
    password = "oldpass8";
  // ConvexCredentials stores the resolved crypto provider in options.
  const provider = Password() as unknown as {
    options: { crypto: { hashSecret: (value: string) => Promise<string> } };
  };
  const hash = await provider.options.crypto.hashSecret(password);
  const id = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Original owner",
      username: "legacy-reader",
      usernameNormalized: "legacy-reader",
      email: "legacy-reader@users.symbaiex.local",
      role: "owner",
    });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: "legacy-reader@users.symbaiex.local",
      secret: hash,
    });
    return userId;
  });
  expect(
    (
      await request(t, "/sign-in/legacy", {
        username: "legacy-reader",
        password: "wrong-password",
      })
    ).status,
  ).toBe(401);
  const migrated = await request(t, "/sign-in/legacy", {
    username: "legacy-reader",
    password,
  });
  expect(migrated.status).toBe(200);
  const login = await request(t, "/sign-in/username", {
    username: "legacy-reader",
    password,
  });
  expect(login.status).toBe(200);
  const token = await (
    await request(t, "/convex/token", undefined, cookies(login))
  ).json();
  const payload = JSON.parse(
    atob(token.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
  );
  const viewer = t.withIdentity({
    issuer: payload.iss,
    subject: payload.sub,
    sessionId: payload.sessionId,
    authSystem: payload.authSystem,
  });
  expect(
    await viewer.mutation(api.identityData.ensureIdentity, {}),
  ).toMatchObject({ userId: id, created: false });
  expect(await viewer.query(api.users.maybeViewer, {})).toMatchObject({
    _id: id,
    role: "owner",
  });
  expect(
    (
      await request(t, "/sign-in/legacy", {
        username: "legacy-reader",
        password,
      })
    ).status,
  ).toBe(401);
  const legacy = t.withIdentity({
    issuer: "https://strong-bee-384.convex.site",
    subject: id + "|old-session",
  });
  expect(await legacy.query(api.users.maybeViewer, {})).toBeNull();
});
test("mailbox proof plus old password links a previously unmapped native identity without orphaning it", async () => {
  const t = setup(),
    password = "oldpass8";
  const provider = Password() as unknown as {
    options: { crypto: { hashSecret: (value: string) => Promise<string> } };
  };
  const hash = await provider.options.crypto.hashSecret(password);
  const original = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "reader@example.com",
      username: "link-reader",
      usernameNormalized: "link-reader",
      role: "owner",
    });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: "link-reader@users.symbaiex.local",
      secret: hash,
    });
    return userId;
  });
  await request(t, "/email-otp/send-verification-otp", {
    email: "reader@example.com",
    type: "sign-in",
  });
  const otp = mail.messages[0].text.match(/\b(\d{6})\b/)![1];
  const verified = await request(t, "/sign-in/email-otp", {
    email: "reader@example.com",
    otp,
  });
  const before = await (
    await request(t, "/get-session", undefined, cookies(verified))
  ).json();
  const migrated = await request(
    t,
    "/sign-in/legacy",
    { username: "link-reader", password },
    cookies(verified),
  );
  expect(migrated.status).toBe(200);
  const after = await (
    await request(t, "/get-session", undefined, cookies(migrated))
  ).json();
  expect(after.user.id).toBe(before.user.id);
  const token = await (
    await request(t, "/convex/token", undefined, cookies(migrated))
  ).json();
  const payload = JSON.parse(
    atob(token.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
  );
  const viewer = t.withIdentity({
    issuer: payload.iss,
    subject: payload.sub,
    sessionId: payload.sessionId,
    authSystem: payload.authSystem,
  });
  expect(
    await viewer.mutation(api.identityData.ensureIdentity, {}),
  ).toMatchObject({ userId: original, created: false });
  expect(await t.run((ctx) => ctx.db.get("users", original))).toMatchObject({
    role: "owner",
    email: "reader@example.com",
    emailVerificationTime: expect.any(Number),
  });
});
