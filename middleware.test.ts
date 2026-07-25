import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const authState = vi.hoisted(() => ({
  authenticated: false,
  middlewareOptions: null as {
    cookieConfig?: { maxAge: number | null };
  } | null,
}));

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  createRouteMatcher: (patterns: string[]) => (request: NextRequest) =>
    patterns.includes(request.nextUrl.pathname),
  convexAuthNextjsMiddleware: (
    handler: (
      request: NextRequest,
      context: { convexAuth: { isAuthenticated: () => Promise<boolean> } },
    ) => Promise<Response> | Response,
    options: { cookieConfig?: { maxAge: number | null } },
  ) => {
    authState.middlewareOptions = options;
    return (request: NextRequest) =>
      handler(request, {
        convexAuth: {
          isAuthenticated: async () => authState.authenticated,
        },
      });
  },
  nextjsMiddlewareRedirect: (request: NextRequest, redirectTo: string) =>
    new Response(null, {
      status: 302,
      headers: {
        location: new URL(redirectTo, request.url).toString(),
      },
    }),
}));

describe("middleware forum routing", () => {
  beforeEach(() => {
    vi.resetModules();
    authState.authenticated = false;
    authState.middlewareOptions = null;
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  });

  test("keeps auth cookies after the browser session closes", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    await loadMiddleware();

    expect(authState.middlewareOptions?.cookieConfig?.maxAge).toBe(
      30 * 24 * 60 * 60,
    );
  });

  test("rewrites bare forum subdomain paths and attaches security headers", async () => {
    const middleware = await loadMiddleware();
    const response = await middleware(
      requestFor("http://forum.localhost:3000/search"),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://forum.localhost:3000/forum/search",
    );
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'nonce-");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  test("redirects prefixed forum subdomain paths to their forum-host path", async () => {
    const middleware = await loadMiddleware();
    const response = await middleware(
      requestFor("http://forum.localhost:3000/forum/search"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://forum.localhost:3000/search",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("does not rewrite site-owned routes on the forum host", async () => {
    const middleware = await loadMiddleware();
    const response = await middleware(
      requestFor("http://forum.localhost:3000/admin"),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
  });

  test("redirects primary-site content routes from the forum host to the primary host", async () => {
    const middleware = await loadMiddleware();
    const response = await middleware(
      requestFor("http://forum.localhost:3000/blog/old-web-notes"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://symbaiex.localhost:3000/blog/old-web-notes",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  test("redirects production forum primary-site routes to the canonical www host", async () => {
    const middleware = await loadMiddleware();
    const response = await middleware(
      requestFor("https://forum.symbaiex.com/about"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://www.symbaiex.com/about",
    );
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("https://symbaiex.com");
    expect(policy).toContain("https://www.symbaiex.com");

    const portedResponse = await middleware(
      requestFor("https://forum.symbaiex.com:3001/news"),
    );
    expect(portedResponse.headers.get("location")).toBe(
      "https://www.symbaiex.com/news",
    );
  });

  test("sanitizes authenticated sign-in redirect destinations", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    authState.authenticated = true;

    const middleware = await loadMiddleware();
    const response = await middleware(
      requestFor("http://localhost:3000/signin?redirectTo=//evil.example"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });
});

async function loadMiddleware() {
  const mod = await import("./middleware");
  return mod.default as (request: NextRequest) => Promise<Response> | Response;
}

function requestFor(url: string) {
  const parsed = new URL(url);
  return new NextRequest(url, {
    headers: {
      host: parsed.host,
    },
  });
}
