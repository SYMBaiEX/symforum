import {
  NextRequest,
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
} from "next/server";
import { describe, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  SHARED_SESSION_COOKIE,
  SHARED_SESSION_MAX_AGE,
  sealSharedSession,
  unsealSharedSession,
  withSharedLegacySession,
} from "./shared-session";

const environment = {
  AUTH_SHARED_SESSION_SECRET: "1".repeat(64),
  NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
};
const session = {
  token: "test.jwt.signature",
  refreshToken: "private-refresh-token",
};
const event = {} as NextFetchEvent;
const tokenName = "__Host-__convexAuthJWT";
const refreshName = "__Host-__convexAuthRefreshToken";

function request(
  host = "forum.symbaiex.com",
  cookie = "",
  init: {
    method?: string;
    headers?: Record<string, string>;
    path?: string;
  } = {},
) {
  return new NextRequest(`https://${host}${init.path ?? "/"}`, {
    method: init.method,
    headers: { host, cookie, ...init.headers },
  });
}
function sharedCookie(response: Response) {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${SHARED_SESSION_COOKIE}=`));
  return cookie?.split(";", 1)[0].slice(SHARED_SESSION_COOKIE.length + 1);
}

describe("encrypted legacy shared sessions", () => {
  test.each([
    "/api/plugin/mcp",
    "/api/plugin/assets/revision/app.js",
    "/api/agent/mcp",
    "/api/agent/auth/register",
    "/api/docs/mcp",
    "/api/premium-agent/session",
    "/api/sandbox/run",
    "/api/a2a",
    "/api/admin/upload",
    "/api/newsletter/subscribe",
    "/agent-auth/token",
    "/agent-auth/register",
    "/.well-known/oauth-authorization-server",
    "/mcp",
    "/ask",
    "/sandbox",
  ])("bypasses browser sessions entirely for %s", async (path) => {
    const cookie = `${SHARED_SESSION_COOKIE}=malformed; ${tokenName}=${session.token}; ${refreshName}=${session.refreshToken}`;
    const req = request("forum.symbaiex.com", cookie, {
      path,
      method: "POST",
      headers: {
        origin: "https://chatgpt.com",
        authorization: "Bearer remote",
      },
    });
    const middleware = vi.fn(() => NextResponse.next());
    const stateless = vi.fn((forwarded: NextRequest) => {
      expect(forwarded).toBe(req);
      expect(forwarded.headers.get("cookie")).toBe(cookie);
      expect(forwarded.headers.get("authorization")).toBe("Bearer remote");
      return NextResponse.next();
    });
    const response = (await withSharedLegacySession(
      middleware,
      { ...environment, AUTH_SHARED_SESSION_SECRET: "invalid-not-read" },
      stateless,
    )(req, event)) as Response;
    expect(middleware).not.toHaveBeenCalled();
    expect(stateless).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("vary")).toBeNull();
  });

  test.each([
    "/api/auth",
    "/api/auth/",
    "/api/auth/sign-out",
    "/api/admin/ai",
    "/api/admin/telemetry/model",
    "/api/plugin/forum/attachments",
  ])(
    "preserves human session restoration and origin checks for %s",
    async (path) => {
      const cookie = `${SHARED_SESSION_COOKIE}=${await sealSharedSession(session, environment)}`;
      const middleware = vi.fn((req: NextRequest) => {
        expect(req.cookies.get(tokenName)?.value).toBe(session.token);
        expect(req.cookies.get(refreshName)?.value).toBe(session.refreshToken);
        return NextResponse.next();
      });
      const wrapped = withSharedLegacySession(middleware, environment);
      const response = (await wrapped(
        request("forum.symbaiex.com", cookie, {
          path,
          method: "POST",
          headers: { origin: "https://forum.symbaiex.com" },
        }),
        event,
      )) as Response;
      expect(response.status).toBe(200);
      expect(middleware).toHaveBeenCalledOnce();
      const rejected = (await wrapped(
        request("forum.symbaiex.com", cookie, {
          path,
          method: "POST",
          headers: { origin: "https://chatgpt.com" },
        }),
        event,
      )) as Response;
      expect(rejected.status).toBe(403);
      expect(middleware).toHaveBeenCalledOnce();
    },
  );

  test("uses randomized purpose-bound encryption without exposing token values", async () => {
    const sealed = await sealSharedSession(session, environment);
    expect(sealed).not.toContain(session.refreshToken);
    expect(sealed).not.toContain(session.token);
    expect(sealed).not.toEqual(await sealSharedSession(session, environment));
    expect(await unsealSharedSession(sealed, environment)).toMatchObject({
      version: 1,
      session,
    });
    expect(
      await unsealSharedSession(sealed, {
        ...environment,
        NEXT_PUBLIC_CONVEX_URL: "https://other.convex.cloud",
      }),
    ).toBeNull();
    expect(
      await unsealSharedSession(sealed, {
        ...environment,
        AUTH_SHARED_SESSION_SECRET: "2".repeat(64),
      }),
    ).toBeNull();
  });

  test("rejects tampering, malformed versions, expiration and oversized cookies", async () => {
    const now = Date.now();
    const sealed = await sealSharedSession(session, environment, now);
    const [version, iv, encrypted] = sealed.split(".");
    expect(
      await unsealSharedSession(
        `${version}.${iv}.${encrypted[0] === "a" ? "b" : "a"}${encrypted.slice(1)}`,
        environment,
      ),
    ).toBeNull();
    expect(
      await unsealSharedSession(sealed.replace("v1.", "v2."), environment),
    ).toBeNull();
    expect(
      await unsealSharedSession(
        sealed,
        environment,
        now + SHARED_SESSION_MAX_AGE * 1_000,
      ),
    ).toBeNull();
    expect(
      await unsealSharedSession("v1.invalid.invalid", environment),
    ).toBeNull();
    expect(
      await unsealSharedSession("x".repeat(4_000), environment),
    ).toBeNull();
    await expect(
      sealSharedSession({ ...session, token: "x".repeat(4_000) }, environment),
    ).rejects.toThrow("cookie size limit");
  });

  test.each([
    "symbaiex.com",
    "www.symbaiex.com",
    "forum.symbaiex.com",
    "blog.symbaiex.com",
    "news.symbaiex.com",
    "newsletter.symbaiex.com",
  ])(
    "restores session cookies and original request headers on %s",
    async (host) => {
      const cookie = `${SHARED_SESSION_COOKIE}=${await sealSharedSession(session, environment)}`;
      const middleware: NextMiddleware = (req) => {
        expect(req.cookies.get(tokenName)?.value).toBe(session.token);
        expect(req.cookies.get(refreshName)?.value).toBe(session.refreshToken);
        expect(req.headers.get("cookie")).toContain(
          `${refreshName}=${session.refreshToken}`,
        );
        return NextResponse.next({ request: { headers: req.headers } });
      };
      const response = (await withSharedLegacySession(middleware, environment)(
        request(host, cookie),
        event,
      )) as Response;
      expect(response.headers.get("x-middleware-request-cookie")).toContain(
        `${tokenName}=${session.token}`,
      );
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  test.each([
    "evil.test",
    "untrusted.symbaiex.com",
    "symbaiex.com.evil.test",
    "localhost",
    "preview.vercel.app",
    "forum.symbaiex.com:3000",
  ])("does not restore shared sessions on %s", async (host) => {
    const cookie = `${SHARED_SESSION_COOKIE}=${await sealSharedSession(session, environment)}`;
    const middleware: NextMiddleware = (req) => {
      expect(req.cookies.has(tokenName)).toBe(false);
      return NextResponse.next();
    };
    await withSharedLegacySession(middleware, environment)(
      request(host, cookie),
      event,
    );
  });

  test("rejects cross-origin unsafe requests before restoring tokens", async () => {
    const middleware = vi.fn(() => NextResponse.next());
    const cookie = `${SHARED_SESSION_COOKIE}=${await sealSharedSession(session, environment)}`;
    for (const origin of [
      "https://evil.test",
      "https://www.symbaiex.com",
      "null",
    ]) {
      const response = (await withSharedLegacySession(middleware, environment)(
        request("forum.symbaiex.com", cookie, {
          method: "POST",
          headers: { origin },
        }),
        event,
      )) as Response;
      expect(response.status).toBe(403);
    }
    expect(middleware).not.toHaveBeenCalled();
  });

  test("ordinary cross-site reads neither restore nor republish stale host sessions", async () => {
    const marker = await sealSharedSession(null, environment);
    const cookie = `${SHARED_SESSION_COOKIE}=${marker}; ${tokenName}=${session.token}; ${refreshName}=${session.refreshToken}`;
    const middleware = vi.fn((req: NextRequest) => {
      // The existing host cookies remain the SDK's responsibility. A routine
      // refresh on a cross-site read must not revive a global signed-out state.
      expect(req.cookies.get(tokenName)?.value).toBe(session.token);
      const response = NextResponse.next();
      response.cookies.set(tokenName, "rotated-token");
      response.cookies.set(refreshName, "rotated-refresh");
      return response;
    });
    const response = (await withSharedLegacySession(middleware, environment)(
      request("forum.symbaiex.com", cookie, {
        headers: { "sec-fetch-site": "cross-site", accept: "text/html" },
      }),
      event,
    )) as Response;
    expect(sharedCookie(response)).toBeUndefined();
  });

  test("promotes an existing host session without changing __Host cookie scopes", async () => {
    const req = request(
      "www.symbaiex.com",
      `${tokenName}=${session.token}; ${refreshName}=${session.refreshToken}`,
    );
    const response = (await withSharedLegacySession(
      () => NextResponse.next(),
      environment,
    )(req, event)) as Response;
    const value = sharedCookie(response)!;
    expect(await unsealSharedSession(value, environment)).toMatchObject({
      session,
    });
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toContain(
      "Domain=.symbaiex.com",
    );
    expect(response.headers.getSetCookie()[0]).toContain(
      "Secure; HttpOnly; SameSite=Lax",
    );
  });

  test("synchronizes token refresh and signs out stale sibling sessions", async () => {
    const cookie = `${SHARED_SESSION_COOKIE}=${await sealSharedSession(session, environment)}`;
    const rotated = {
      token: "rotated.jwt.signature",
      refreshToken: "rotated-private-refresh-token",
    };
    const refresh: NextMiddleware = () => {
      const response = NextResponse.next();
      response.cookies.set(tokenName, rotated.token, {
        secure: true,
        httpOnly: true,
        path: "/",
      });
      response.cookies.set(refreshName, rotated.refreshToken, {
        secure: true,
        httpOnly: true,
        path: "/",
      });
      return response;
    };
    const response = (await withSharedLegacySession(refresh, environment)(
      request("forum.symbaiex.com", cookie),
      event,
    )) as Response;
    const shared = sharedCookie(response)!;
    expect(await unsealSharedSession(shared, environment)).toMatchObject({
      session: rotated,
    });
    for (const cookie of response.headers
      .getSetCookie()
      .filter((value) => value.startsWith("__Host-")))
      expect(cookie).not.toContain("Domain=");

    const logout: NextMiddleware = () => {
      const response = NextResponse.next();
      response.cookies.set(tokenName, "", {
        secure: true,
        httpOnly: true,
        path: "/",
        maxAge: 0,
      });
      response.cookies.set(refreshName, "", {
        secure: true,
        httpOnly: true,
        path: "/",
        maxAge: 0,
      });
      return response;
    };
    const signedOut = (await withSharedLegacySession(logout, environment)(
      request("forum.symbaiex.com", `${SHARED_SESSION_COOKIE}=${shared}`),
      event,
    )) as Response;
    const marker = sharedCookie(signedOut)!;
    expect(await unsealSharedSession(marker, environment)).toMatchObject({
      session: null,
    });
    const stale = request(
      "www.symbaiex.com",
      `${SHARED_SESSION_COOKIE}=${marker}; ${tokenName}=${session.token}; ${refreshName}=${session.refreshToken}`,
    );
    const cleared = (await withSharedLegacySession((req) => {
      expect(req.cookies.has(tokenName)).toBe(false);
      expect(req.cookies.has(refreshName)).toBe(false);
      expect(req.headers.get("cookie")).not.toContain(session.refreshToken);
      return NextResponse.next();
    }, environment)(stale, event)) as Response;
    expect(sharedCookie(cleared)).toBeUndefined();
  });

  test("publishes a new login from SDK response cookies without a previous session", async () => {
    const response = (await withSharedLegacySession(() => {
      const response = NextResponse.json({
        tokens: { token: session.token, refreshToken: "dummy" },
      });
      response.cookies.set(tokenName, session.token, {
        secure: true,
        httpOnly: true,
        path: "/",
      });
      response.cookies.set(refreshName, session.refreshToken, {
        secure: true,
        httpOnly: true,
        path: "/",
      });
      return response;
    }, environment)(request("www.symbaiex.com"), event)) as Response;
    expect(
      await unsealSharedSession(sharedCookie(response)!, environment),
    ).toMatchObject({ session });
    expect(await response.json()).toEqual({
      tokens: { token: session.token, refreshToken: "dummy" },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  test("missing configuration leaves existing host sessions untouched", async () => {
    const req = request(
      "www.symbaiex.com",
      `${tokenName}=${session.token}; ${refreshName}=${session.refreshToken}`,
    );
    const response = (await withSharedLegacySession((req) => {
      expect(req.cookies.get(tokenName)?.value).toBe(session.token);
      return NextResponse.next();
    }, {})(req, event)) as Response;
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
