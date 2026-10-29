import { afterEach, expect, test, vi } from "vitest";
import { getAddressDecoder } from "@solana/kit";
import { createSignInMessage } from "@solana/wallet-standard-util";
import { createWalletDebugHandler } from "./wallet-debug-server";

const origin = "http://127.0.0.1:43218";
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
afterEach(() => vi.useRealTimers());
function harness() {
  const handler = createWalletDebugHandler(
    origin,
    "console.log('local fixture')",
  );
  return {
    handler,
    call(
      path: string,
      body?: unknown,
      cookie?: string,
      extra: Record<string, string> = {},
    ) {
      return handler(
        new Request(origin + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            host: new URL(origin).host,
            origin,
            ...(cookie ? { cookie } : {}),
            ...extra,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    },
  };
}
async function issue(h: ReturnType<typeof harness>) {
  const response = await h.call("/api/identity/identity/challenge", {
    provider: "solana",
    purpose: "login",
  });
  expect(response.status).toBe(200);
  const challenge = await response.json();
  return {
    challenge,
    cookie: response.headers.get("set-cookie")!.split(";")[0],
  };
}

test("local verifier rejects non-loopback configuration and DNS rebinding/cross-origin requests", async () => {
  expect(() =>
    createWalletDebugHandler("https://forum.symbaiex.com", ""),
  ).toThrow();
  const h = harness();
  expect(
    (await h.call("/", undefined, undefined, { host: "evil.example" })).status,
  ).toBe(403);
  expect(
    (
      await h.call("/api/identity/identity/challenge", {}, undefined, {
        origin: "https://evil.example",
      })
    ).status,
  ).toBe(403);
});

test("serves only local assets, blocks external connections and never proxies production", async () => {
  const h = harness();
  const page = await h.call("/");
  expect(page.headers.get("content-security-policy")).toContain(
    "connect-src 'self'",
  );
  expect(page.headers.get("cache-control")).toBe("no-store");
  expect((await h.call("/wallet-debug.js")).status).toBe(200);
  expect((await h.call("/api/identity/get-session")).status).toBe(200);
  expect(await (await h.call("/api/identity/get-session")).json()).toBeNull();
  expect((await h.call("/api/identity/unknown", {})).status).toBe(404);
  expect(
    (
      await h.call("/api/identity/identity/challenge", {
        provider: "telegram",
        purpose: "login",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await h.call("/api/identity/identity/challenge", {
        provider: "solana",
        purpose: "link",
      })
    ).status,
  ).toBe(400);
});

test("a real Ed25519 proof verifies locally once, bound to the browser and exact challenge", async () => {
  const h = harness();
  const { challenge, cookie } = await issue(h);
  const keys = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", keys.publicKey),
  );
  const address = getAddressDecoder().decode(publicKey);
  const message = createSignInMessage({ ...challenge.input, address });
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      keys.privateKey,
      Uint8Array.from(message),
    ),
  );
  const proof = {
    nonce: challenge.nonce,
    address,
    publicKey: b64(publicKey),
    signedMessage: b64(message),
    signature: b64(signature),
  };
  expect((await h.call("/api/identity/sign-in/solana", proof)).status).toBe(
    401,
  );
  expect(
    (await h.call("/api/identity/sign-in/solana", proof, cookie)).status,
  ).toBe(200);
  expect(
    await (await h.call("/api/identity/get-session", undefined, cookie)).json(),
  ).toMatchObject({ user: { id: "local-only" } });
  expect(
    (await h.call("/api/identity/sign-in/solana", proof, cookie)).status,
  ).toBe(401);
  expect(await (await h.call("/api/identity/get-session")).json()).toBeNull();
});

test("invalid proofs consume the challenge; expired challenges and oversized requests fail closed", async () => {
  const h = harness();
  const { challenge, cookie } = await issue(h);
  const invalid = {
    nonce: challenge.nonce,
    address: "11111111111111111111111111111111",
    publicKey: b64(new Uint8Array(32)),
    signature: b64(new Uint8Array(64)),
    signedMessage: b64(new Uint8Array([1])),
  };
  expect(
    (await h.call("/api/identity/sign-in/solana", invalid, cookie)).status,
  ).toBe(401);
  expect(
    (await h.call("/api/identity/sign-in/solana", invalid, cookie)).status,
  ).toBe(401);
  const next = await issue(h);
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 300_001);
  expect(
    (
      await h.call(
        "/api/identity/sign-in/solana",
        { ...invalid, nonce: next.challenge.nonce },
        next.cookie,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await h.call("/api/identity/identity/challenge", {
        padding: "x".repeat(8200),
      })
    ).status,
  ).toBe(413);
});
