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

vi.mock("@workos-inc/authkit-nextjs", () => ({
  applyResponseHeaders: (response: Response) => response,
  authkit: async () => ({ headers: new Headers(), session: null }),
  partitionAuthkitHeaders: () => ({
    requestHeaders: new Headers(),
    responseHeaders: new Headers(),
  }),
}));

describe("proxy forum routing", () => {
  test.each([
    ["blog.symbaiex.com", "/blog"],
    ["news.symbaiex.com", "/news"],
    ["newsletter.symbaiex.com", "/newsletter"],
  ])("rewrites the %s root to its content route", async (host, route) => {
    const proxy = await loadProxy();
    const response = await proxy(requestFor(`https://${host}/?source=home`));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `https://${host}${route}?source=home`,
    );
    expect(response.headers.get("location")).toBeNull();
  });

  test("keeps OAuth completion identifiers out of referrers, caches and indexing", async () => {
    const proxy = await loadProxy();
    const response = await proxy(
      requestFor(
        "https://www.symbaiex.com/agent/connect?external_auth_id=temporary",
      ),
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
  beforeEach(() => {
    vi.resetModules();
    authState.authenticated = false;
    authState.middlewareOptions = null;
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.WEBMCP_ORIGIN_TRIAL_TOKEN;
  });

  test("scopes an opt-in WebMCP trial token to canonical HTML tool pages", async () => {
    process.env.WEBMCP_ORIGIN_TRIAL_TOKEN = "owner-issued-trial-token";
    const proxy = await loadProxy();
    const page = await proxy(
      requestFor("https://www.symbaiex.com/developers", {
        accept: "text/html",
      }),
    );
    expect(page.headers.get("origin-trial")).toBe("owner-issued-trial-token");

    const markdown = await proxy(
      requestFor("https://www.symbaiex.com/developers?mode=agent", {
        accept: "text/html",
      }),
    );
    expect(markdown.headers.get("origin-trial")).toBeNull();

    const api = await proxy(
      requestFor("https://www.symbaiex.com/api/agent", {
        accept: "application/json",
      }),
    );
    expect(api.headers.get("origin-trial")).toBeNull();

    const forumHost = await proxy(
      requestFor("https://forum.symbaiex.com/developers", {
        accept: "text/html",
      }),
    );
    expect(forumHost.headers.get("origin-trial")).toBeNull();
  });

  test("does not emit an absent or malformed WebMCP Origin Trial token", async () => {
    process.env.WEBMCP_ORIGIN_TRIAL_TOKEN = "invalid\nheader";
    const proxy = await loadProxy();
    const response = await proxy(
      requestFor("https://www.symbaiex.com/", { accept: "text/html" }),
    );
    expect(response.headers.get("origin-trial")).toBeNull();
  });

  test("keeps auth cookies after the browser session closes", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    await loadProxy();

    expect(authState.middlewareOptions?.cookieConfig?.maxAge).toBe(
      30 * 24 * 60 * 60,
    );
  });

  test("rewrites bare forum subdomain paths and attaches security headers", async () => {
    const proxy = await loadProxy();
    const response = await proxy(
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
    const discoveryLinks = response.headers.get("link") ?? "";
    expect(discoveryLinks).toContain(
      '<https://www.symbaiex.com/.well-known/mcp/server-card.json>; rel="service-desc"; type="application/mcp-server-card+json"',
    );
    expect(discoveryLinks).toContain(
      '<https://www.symbaiex.com/.well-known/mcp>; rel="service-desc"; type="application/mcp-server-card+json"',
    );
    expect(discoveryLinks).toContain(
      '<https://www.symbaiex.com/mcp/server-card>; rel="service-desc"; type="application/mcp-server-card+json"',
    );
    expect(discoveryLinks).toContain(
      '<https://www.symbaiex.com/api/docs/mcp/server-card>; rel="service-desc"; type="application/mcp-server-card+json"',
    );
    expect(discoveryLinks).toContain(
      '<https://www.symbaiex.com/api/sandbox/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
    );
  });

  test("redirects prefixed forum subdomain paths to their forum-host path", async () => {
    const proxy = await loadProxy();
    const response = await proxy(
      requestFor("http://forum.localhost:3000/forum/search"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://forum.localhost:3000/search",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("does not rewrite site-owned routes on the forum host", async () => {
    const proxy = await loadProxy();
    const response = await proxy(
      requestFor("http://forum.localhost:3000/admin"),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
  });

  test("allows cross-subdomain navigation between the published surfaces", async () => {
    const proxy = await loadProxy();
    const response = await proxy(
      requestFor("https://news.symbaiex.com/news"),
    );
    const policy = response.headers.get("content-security-policy") ?? "";

    expect(policy).toContain("https://forum.symbaiex.com");
    expect(policy).toContain("https://blog.symbaiex.com");
    expect(policy).toContain("https://news.symbaiex.com");
    expect(policy).toContain("https://newsletter.symbaiex.com");
  });

  test("serves the forum manifest through native same-origin Next metadata", async () => {
    const proxy = await loadProxy();
    const response = await proxy(
      requestFor("https://forum.symbaiex.com/manifest.webmanifest"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  test("rewrites explicit markdown aliases and negotiated markdown requests", async () => {
    const proxy = await loadProxy();

    const aliasResponse = await proxy(
      requestFor("http://localhost:3000/about.md"),
    );
    expect(aliasResponse.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/markdown/about",
    );
    expect(aliasResponse.headers.get("vary")).toContain("Accept");
    expect(aliasResponse.headers.get("vary")).toContain("Host");

    const negotiatedResponse = await proxy(
      requestFor("http://localhost:3000/about", {
        accept: "text/markdown",
      }),
    );
    expect(negotiatedResponse.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/markdown/about",
    );
  });

  test("preserves native MCP routes for markdown-capable clients", async () => {
    const proxy = await loadProxy();

    for (const pathname of [
      "/mcp",
      "/mcp/server-card",
      "/api/agent/mcp/server-card",
      "/api/docs/mcp/server-card",
      "/api/agent/mcp",
      "/api/docs/mcp",
    ]) {
      const response = await proxy(
        requestFor(`https://www.symbaiex.com${pathname}`, {
          accept: "application/json, text/markdown;q=0.8",
        }),
      );

      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }

    const privateResponse = await proxy(
      requestFor("https://www.symbaiex.com/admin", {
        accept: "application/json, text/markdown;q=0.8",
      }),
    );
    expect(privateResponse.status).toBe(404);
    expect(privateResponse.headers.get("content-type")).toContain("text/plain");
  });

  test("leaves canonical root Markdown resources on their own routes", async () => {
    const proxy = await loadProxy();

    for (const pathname of ["/agents.md", "/auth.md"]) {
      const response = await proxy(
        requestFor(`http://localhost:3000${pathname}`),
      );
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  });

  test("serves agent mode and recognized agent user agents as Markdown", async () => {
    const proxy = await loadProxy();

    const modeResponse = await proxy(
      requestFor("http://localhost:3000/about?mode=agent"),
    );
    expect(modeResponse.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/markdown/about?mode=agent",
    );

    const botResponse = await proxy(
      requestFor("http://localhost:3000/about", {
        "user-agent": "ora-agent/1.0",
      }),
    );
    expect(botResponse.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/markdown/about",
    );
    expect(botResponse.headers.get("vary")).toContain("User-Agent");
  });

  test("advertises a working page-specific Markdown alternate", async () => {
    const proxy = await loadProxy();
    const response = await proxy(requestFor("http://localhost:3000/about"));

    expect(response.headers.get("link")).toContain(
      '<http://localhost:3000/about.md>; rel="alternate"; type="text/markdown"',
    );

    const homeResponse = await proxy(requestFor("http://localhost:3000/"));
    expect(homeResponse.headers.get("link")).toContain(
      '<http://localhost:3000/index.md>; rel="alternate"; type="text/markdown"',
    );
  });

  test("records safe negotiation context without logging credentials", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const proxy = await loadProxy();

    await proxy(
      requestFor("http://localhost:3000/about", {
        accept: "text/markdown",
        referer: "https://agent.example.test/task/42",
        authorization: "Bearer should-not-be-logged",
        cookie: "session=should-not-be-logged",
        "user-agent": "ExampleAgent/1.0",
      }),
    );

    expect(info).toHaveBeenCalledTimes(1);
    const details = info.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(details).toMatchObject({
      host: "localhost:3000",
      method: "GET",
      pathname: "/about",
      format: "content-negotiated-markdown",
      accept: "text/markdown",
      referer: "https://agent.example.test/task/42",
      userAgent: "ExampleAgent/1.0",
    });
    expect(JSON.stringify(details)).not.toContain("should-not-be-logged");
    info.mockRestore();
  });

  test("does not negotiate markdown for wildcard or refused media types", async () => {
    const proxy = await loadProxy();

    for (const accept of ["*/*", "text/markdown;q=0, text/html"]) {
      const response = await proxy(
        requestFor("http://localhost:3000/about", { accept }),
      );
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  test("signals positive Markdown negotiation for unmatched-route fallback only", async () => {
    const proxy = await loadProxy();
    const requestHeader = "x-middleware-request-x-symbaiex-markdown-404";

    const markdownResponse = await proxy(
      requestFor("http://localhost:3000/__ora-404-probe-test", {
        accept: "application/json, text/markdown;q=0.8",
      }),
    );
    expect(markdownResponse.headers.get(requestHeader)).toBe("1");

    const refusedResponse = await proxy(
      requestFor("http://localhost:3000/__ora-404-probe-test", {
        accept: "text/markdown;q=0, text/html",
        "x-symbaiex-markdown-404": "1",
      }),
    );
    expect(refusedResponse.headers.get(requestHeader)).toBeNull();
  });

  test("redirects primary-site content routes from the forum host to the primary host", async () => {
    const proxy = await loadProxy();
    const response = await proxy(
      requestFor("http://forum.localhost:3000/blog/old-web-notes"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://symbaiex.localhost:3000/blog/old-web-notes",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  test("redirects audited public routes and Markdown contracts from the forum host", async () => {
    const proxy = await loadProxy();
    for (const pathname of [
      "/pricing?plan=team",
      "/pricing.md?plan=team",
      "/agent",
      "/agent/signup",
      "/terms",
      "/auth.md",
      "/agents.md",
    ]) {
      const response = await proxy(
        requestFor(`https://forum.symbaiex.com${pathname}`),
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        `https://www.symbaiex.com${pathname}`,
      );
    }
  });

  test.each(["/research", "/research/source-led-notes"])(
    "Research board RSC prefetch %s stays on the forum origin",
    async (pathname) => {
      const proxy = await loadProxy();
      const response = await proxy(
        requestFor(`https://forum.symbaiex.com${pathname}?_rsc=cache`, {
          rsc: "1",
          "next-router-prefetch": "1",
        }),
      );

      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBe(
        `https://forum.symbaiex.com/forum${pathname}?_rsc=cache`,
      );
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    },
  );

  test("primary-site Research content keeps its own route", async () => {
    const proxy = await loadProxy();
    const response = await proxy(
      requestFor("https://www.symbaiex.com/research/methodology"),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  test("redirects production forum primary-site routes to the canonical www host", async () => {
    const proxy = await loadProxy();
    const response = await proxy(
      requestFor("https://forum.symbaiex.com/about"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://www.symbaiex.com/about",
    );
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("https://symbaiex.com");
    expect(policy).toContain("https://www.symbaiex.com");

    const portedResponse = await proxy(
      requestFor("https://forum.symbaiex.com:3001/news"),
    );
    expect(portedResponse.headers.get("location")).toBe(
      "https://www.symbaiex.com/news",
    );
  });

  test("sanitizes authenticated sign-in redirect destinations", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    authState.authenticated = true;

    const proxy = await loadProxy();
    const response = await proxy(
      requestFor("http://localhost:3000/signin?redirectTo=//evil.example"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });
});

async function loadProxy() {
  const mod = await import("./proxy");
  return mod.default as (request: NextRequest) => Promise<Response> | Response;
}

function requestFor(url: string, headers: Record<string, string> = {}) {
  const parsed = new URL(url);
  return new NextRequest(url, {
    headers: {
      host: parsed.host,
      ...headers,
    },
  });
}
