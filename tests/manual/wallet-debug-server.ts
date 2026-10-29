import { randomBytes } from "node:crypto";
import {
  walletLoginInput,
  verifyWalletLogin,
} from "../../lib/human-auth-proof";

// Memory-only local verifier. No env, credentials, Convex, RPC, production
// accounts, or persistence. This handler is never imported by an app route.
export function createWalletDebugHandler(origin: string, javascript: string) {
  const expected = new URL(origin);
  if (expected.hostname !== "127.0.0.1" || expected.protocol !== "http:")
    throw new Error("Wallet diagnostics must bind to loopback HTTP.");
  const browsers = new Map<
    string,
    {
      createdAt: number;
      challenge?: ReturnType<typeof walletLoginInput>;
      verified: boolean;
    }
  >();
  return async (request: Request) => {
    const url = new URL(request.url);
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; connect-src 'self'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    };
    const json = (body: unknown, status = 200, cookie?: string) =>
      Response.json(body, {
        status,
        headers: { ...headers, ...(cookie ? { "Set-Cookie": cookie } : {}) },
      });
    if (url.origin !== origin || request.headers.get("host") !== expected.host)
      return json({ error: "Loopback host required." }, 403);
    if (request.method === "POST" && request.headers.get("origin") !== origin)
      return json({ error: "Same-origin request required." }, 403);
    if (!["GET", "POST"].includes(request.method)) return json({}, 405);
    if (request.method === "GET" && url.pathname === "/")
      return new Response(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local Solana Kit diagnostics</title><link rel="icon" href="data:,"><body><div id="root"></div><script src="/wallet-debug.js"></script></body></html>`,
        {
          headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
        },
      );
    if (request.method === "GET" && url.pathname === "/wallet-debug.js")
      return new Response(javascript, {
        headers: {
          ...headers,
          "Content-Type": "text/javascript; charset=utf-8",
        },
      });

    const now = Date.now();
    for (const [id, browser] of browsers)
      if (browser.createdAt < now - 900_000) browsers.delete(id);
    const id = request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)wallet-debug=([a-f0-9]{48})(?:;|$)/)?.[1];
    const browser = id ? browsers.get(id) : undefined;
    if (
      request.method === "GET" &&
      url.pathname === "/api/identity/get-session"
    ) {
      if (!browser?.verified) return json(null);
      // Only the real shared session atom sees this local demonstration session.
      // It is never accepted by Convex or a production application.
      const time = new Date(now).toISOString();
      return json({
        session: {
          id: "local-proof-verified",
          userId: "local-only",
          token: "local-only",
          createdAt: time,
          updatedAt: time,
          expiresAt: new Date(now + 900_000).toISOString(),
        },
        user: {
          id: "local-only",
          name: "Local verification",
          email: "local@example.invalid",
          emailVerified: false,
          createdAt: time,
          updatedAt: time,
        },
      });
    }
    if (request.method !== "POST") return json({}, 404);
    if (Number(request.headers.get("content-length") ?? 0) > 8192)
      return json({}, 413);
    const bodyText = await request.text();
    if (bodyText.length > 8192) return json({}, 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return json({}, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({}, 400);
    }
    if (url.pathname === "/api/identity/identity/challenge") {
      if (body.provider !== "solana" || body.purpose !== "login")
        return json({}, 400);
      if (browsers.size >= 100 && !browser) return json({}, 429);
      const nextId = id && browser ? id : randomBytes(24).toString("hex");
      const input = {
        ...walletLoginInput({
          origin,
          nonce: randomBytes(16).toString("hex"),
          createdAt: now,
          expiresAt: now + 300_000,
          purpose: "login",
        }),
        statement:
          "Verify a local SYMBaiEX wallet diagnostic. No production login, transaction or spending approval.",
      };
      browsers.set(nextId, {
        createdAt: now,
        challenge: input,
        verified: false,
      });
      return json(
        { nonce: input.nonce, input },
        200,
        `wallet-debug=${nextId}; Path=/api/identity; HttpOnly; SameSite=Strict; Max-Age=900`,
      );
    }
    if (url.pathname === "/api/identity/sign-in/solana") {
      const challenge = browser?.challenge;
      // Consume before verification: no replay, even after an invalid proof.
      if (browser) browser.challenge = undefined;
      if (
        !browser ||
        !challenge ||
        Date.parse(challenge.expirationTime) <= now ||
        body.nonce !== challenge.nonce ||
        !["address", "publicKey", "signature", "signedMessage"].every(
          (key) => typeof body[key] === "string",
        )
      )
        return json({ error: "Local proof rejected." }, 401);
      const valid = verifyWalletLogin(
        challenge,
        body as {
          address: string;
          publicKey: string;
          signature: string;
          signedMessage: string;
        },
      );
      browser.verified = valid;
      return json({ locallyVerified: valid }, valid ? 200 : 401);
    }
    return json({}, 404);
  };
}
