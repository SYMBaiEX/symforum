import "server-only";

import {
  NextResponse,
  type NextMiddleware,
  type NextRequest,
} from "next/server";

export const SHARED_SESSION_COOKIE = "__Secure-symbaiex-session";
export const SHARED_SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const TOKEN_COOKIE = "__Host-__convexAuthJWT";
const REFRESH_COOKIE = "__Host-__convexAuthRefreshToken";
const TRUSTED_HOSTS = new Set([
  "symbaiex.com",
  "www.symbaiex.com",
  "forum.symbaiex.com",
  "blog.symbaiex.com",
  "news.symbaiex.com",
  "newsletter.symbaiex.com",
]);
const COOKIE_DOMAIN = ".symbaiex.com";
const MAX_COOKIE_VALUE_LENGTH = 3_800;
const PURPOSE = "symbaiex:legacy-human-session:v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Session = { token: string; refreshToken: string };
type Envelope = { version: 1; expiresAt: number; session: Session | null };
type Environment = {
  [key: string]: string | undefined;
  AUTH_SHARED_SESSION_SECRET?: string;
  NEXT_PUBLIC_CONVEX_URL?: string;
};

export function usesHumanSession(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  const within = (prefix: string) =>
    path === prefix || path.startsWith(`${prefix}/`);
  if (within("/api")) {
    // The remaining API routes own bearer credentials, public access, or OAuth.
    // Ambient browser cookies must not authenticate or refresh those requests.
    return (
      within("/api/auth") ||
      path === "/api/admin/ai" ||
      path === "/api/admin/telemetry/model" ||
      path === "/api/plugin/forum/attachments"
    );
  }
  return !["/agent-auth", "/.well-known", "/mcp", "/ask", "/sandbox"].some(
    within,
  );
}

function trustedRequest(request: NextRequest) {
  return (
    request.nextUrl.protocol === "https:" &&
    !request.nextUrl.port &&
    TRUSTED_HOSTS.has(request.nextUrl.hostname) &&
    request.headers.get("host")?.toLowerCase() === request.nextUrl.host
  );
}

function sameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === request.nextUrl.origin;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

async function keyFor(environment: Environment) {
  const secret = environment.AUTH_SHARED_SESSION_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error(
      "AUTH_SHARED_SESSION_SECRET must be a random 32-byte hex secret",
    );
  }
  if (!environment.NEXT_PUBLIC_CONVEX_URL) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL is required for shared human sessions",
    );
  }
  const bytes = Uint8Array.from(secret.match(/../g)!, (value) =>
    parseInt(value, 16),
  );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function additionalData(environment: Environment) {
  return encoder.encode(
    `${PURPOSE}:${COOKIE_DOMAIN}:${environment.NEXT_PUBLIC_CONVEX_URL}`,
  );
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(value: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value))
    throw new Error("Invalid session encoding");
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function sealSharedSession(
  session: Session | null,
  environment: Environment,
  now = Date.now(),
) {
  const key = await keyFor(environment);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const envelope: Envelope = {
    version: 1,
    expiresAt: now + SHARED_SESSION_MAX_AGE * 1_000,
    session,
  };
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(environment) },
    key,
    encoder.encode(JSON.stringify(envelope)),
  );
  const value = `v1.${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
  if (value.length > MAX_COOKIE_VALUE_LENGTH)
    throw new Error("Shared human session exceeds cookie size limit");
  return value;
}

export async function unsealSharedSession(
  value: string,
  environment: Environment,
  now = Date.now(),
): Promise<Envelope | null> {
  const key = await keyFor(environment);
  try {
    if (value.length > MAX_COOKIE_VALUE_LENGTH) return null;
    const [version, nonce, ciphertext, extra] = value.split(".");
    if (version !== "v1" || !nonce || !ciphertext || extra !== undefined)
      return null;
    const iv = fromBase64url(nonce);
    if (iv.length !== 12) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(environment) },
      key,
      fromBase64url(ciphertext),
    );
    const envelope: unknown = JSON.parse(decoder.decode(plain));
    if (typeof envelope !== "object" || envelope === null) return null;
    const record = envelope as Record<string, unknown>;
    if (
      record.version !== 1 ||
      typeof record.expiresAt !== "number" ||
      !Number.isFinite(record.expiresAt) ||
      record.expiresAt <= now ||
      record.expiresAt > now + SHARED_SESSION_MAX_AGE * 1_000
    )
      return null;
    if (record.session === null)
      return { version: 1, expiresAt: record.expiresAt, session: null };
    if (typeof record.session !== "object" || record.session === null)
      return null;
    const session = record.session as Record<string, unknown>;
    if (
      typeof session.token !== "string" ||
      !session.token ||
      typeof session.refreshToken !== "string" ||
      !session.refreshToken
    )
      return null;
    return {
      version: 1,
      expiresAt: record.expiresAt,
      session: { token: session.token, refreshToken: session.refreshToken },
    };
  } catch {
    return null;
  }
}

function requestSession(request: NextRequest): Session | null {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  return token && refreshToken ? { token, refreshToken } : null;
}

function restoreRequestSession(request: NextRequest, session: Session | null) {
  if (session === null) {
    request.cookies.delete(TOKEN_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
  } else {
    // NextRequest.cookies updates the original Cookie header. Next.js's lazy
    // next/headers cookie store and the SDK must see this before either is read.
    request.cookies.set(TOKEN_COOKIE, session.token);
    request.cookies.set(REFRESH_COOKIE, session.refreshToken);
  }
}

function responseSession(response: Response, original: Session | null) {
  let token = original?.token;
  let refreshToken = original?.refreshToken;
  let changed = false;
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    if (name !== TOKEN_COOKIE && name !== REFRESH_COOKIE) continue;
    changed = true;
    const value = decodeURIComponent(pair.slice(separator + 1));
    if (name === TOKEN_COOKIE) token = value;
    else refreshToken = value;
  }
  return {
    changed,
    session: token && refreshToken ? { token, refreshToken } : null,
  };
}

export function withSharedLegacySession(
  middleware: NextMiddleware,
  environment: Environment = process.env,
  statelessMiddleware: NextMiddleware = () => NextResponse.next(),
): NextMiddleware {
  return async (request, event) => {
    if (!usesHumanSession(request.nextUrl.pathname))
      return statelessMiddleware(request, event);
    if (!environment.AUTH_SHARED_SESSION_SECRET || !trustedRequest(request))
      return middleware(request, event);
    if (!sameOriginRequest(request)) {
      if (
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        request.method !== "OPTIONS"
      ) {
        return new NextResponse("Invalid origin", { status: 403 });
      }
      return middleware(request, event);
    }

    const cookie = request.cookies.get(SHARED_SESSION_COOKIE)?.value;
    const shared = cookie
      ? await unsealSharedSession(cookie, environment)
      : null;
    if (shared) restoreRequestSession(request, shared.session);
    const original = requestSession(request);
    const response = await middleware(request, event);
    if (!(response instanceof Response)) return response;
    const updated = responseSession(response, original);
    if (original !== null || updated.changed) {
      response.headers.set("Cache-Control", "private, no-store");
      const vary = response.headers.get("Vary");
      if (
        !vary
          ?.split(",")
          .some((value) => value.trim().toLowerCase() === "cookie")
      ) {
        response.headers.set("Vary", vary ? `${vary}, Cookie` : "Cookie");
      }
    }
    if (updated.changed || (!shared && original !== null)) {
      // An encrypted signed-out marker clears stale sibling host cookies too,
      // so another host cannot republish a session after global sign-out.
      const value = await sealSharedSession(updated.session, environment);
      response.headers.append(
        "Set-Cookie",
        `${SHARED_SESSION_COOKIE}=${value}; Path=/; Domain=${COOKIE_DOMAIN}; Max-Age=${SHARED_SESSION_MAX_AGE}; Secure; HttpOnly; SameSite=Lax`,
      );
    }
    return response;
  };
}
