import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const isSignInPage = createRouteMatcher(["/signin"]);
const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
const SONNER_STYLE_HASHES = [
  "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='",
  "'sha256-CIxDM5jnsGiKqXs2v7NKCY5MzdR9gu6TtiMJrDw29AY='",
  "'sha256-441zG27rExd4/il+NvIqyL8zFx5XmyNQtE381kSkUJk='",
  "'sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo='",
];

export default convexConfigured
  ? convexAuthNextjsMiddleware(
      async (request, { convexAuth }) => {
        const policy = contentSecurityPolicy();
        if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
          const redirectTo = cleanRedirect(
            request.nextUrl.searchParams.get("redirectTo"),
          );
          return applySecurityHeaders(
            nextjsMiddlewareRedirect(request, redirectTo),
            policy,
          );
        }
        return applySecurityHeaders(nextWithNonce(request, policy), policy);
      },
      { convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL },
    )
  : function middleware(request: NextRequest) {
      const policy = contentSecurityPolicy();
      return applySecurityHeaders(
        NextResponse.next({
          request: {
            headers: nonceRequestHeaders(new Headers(request.headers), policy),
          },
        }),
        policy,
      );
    };

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};

function cleanRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function nextWithNonce(request: NextRequest, policy: SecurityPolicy) {
  return NextResponse.next({
    request: {
      headers: nonceRequestHeaders(new Headers(request.headers), policy),
    },
  });
}

function nonceRequestHeaders(headers: Headers, policy: SecurityPolicy) {
  headers.set("x-nonce", policy.nonce);
  headers.set("Content-Security-Policy", policy.value);
  return headers;
}

type SecurityPolicy = {
  nonce: string;
  value: string;
};

function contentSecurityPolicy(): SecurityPolicy {
  const nonce = randomNonce();
  const isDev = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ""}`,
    isDev
      ? "style-src-elem 'self' 'unsafe-inline'"
      : `style-src-elem 'self' 'nonce-${nonce}' ${SONNER_STYLE_HASHES.join(" ")}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.convex.site${isDev ? " http://localhost:* ws://localhost:*" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    isDev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");

  return { nonce, value: policy };
}

function applySecurityHeaders(response: NextResponse, policy: SecurityPolicy) {
  response.headers.set("Content-Security-Policy", policy.value);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  return response;
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
