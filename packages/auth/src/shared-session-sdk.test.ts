// @vitest-environment node
import { expect, test, vi } from "vitest";

await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  Object.assign(globalThis, { AsyncLocalStorage });
});

const backend = vi.hoisted(() => ({
  fetchAction: vi.fn(),
  fetchQuery: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("convex/nextjs", () => backend);

import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { cookies, headers } from "next/headers";
import { createRequestStoreForAPI } from "next/dist/server/async-storage/request-store";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import {
  workAsyncStorage,
  type WorkStore,
} from "next/dist/server/app-render/work-async-storage.external";
import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";
import {
  SHARED_SESSION_COOKIE,
  sealSharedSession,
  unsealSharedSession,
  withSharedLegacySession,
} from "./shared-session";

const environment = {
  AUTH_SHARED_SESSION_SECRET: "1".repeat(64),
  NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
};
const tokenName = "__Host-__convexAuthJWT";
const refreshName = "__Host-__convexAuthRefreshToken";
function jwt(expiresIn = 3_600) {
  return `header.${Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1_000) - 60, exp: Math.floor(Date.now() / 1_000) + expiresIn })).toString("base64url")}.signature`;
}
const original = { token: jwt(), refreshToken: "original-server-only-refresh" };

async function callSdk(
  path: string,
  session: typeof original | null,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const envelope = await sealSharedSession(session, environment);
  const request = new NextRequest(`https://forum.symbaiex.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      host: "forum.symbaiex.com",
      cookie: `${SHARED_SESSION_COOKIE}=${envelope}`,
      ...(body ? { origin: "https://forum.symbaiex.com" } : {}),
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const store = createRequestStoreForAPI(
    request,
    request.nextUrl,
    { tags: [], expirationsByCacheKind: new Map() },
    undefined,
    undefined,
    undefined,
  );
  const middleware = convexAuthNextjsMiddleware(
    async (req) => {
      if (session) expect((await headers()).get("cookie")).toContain(tokenName);
      expect((await cookies()).get(refreshName)?.value).toBe(
        session?.refreshToken,
      );
      return NextResponse.next({ request: { headers: req.headers } });
    },
    {
      convexUrl: environment.NEXT_PUBLIC_CONVEX_URL,
      cookieConfig: { maxAge: 30 * 24 * 60 * 60 },
    },
  );
  // Model the same lazy request store that Next.js creates before Proxy runs.
  const workStore = {
    route: path,
    forceStatic: false,
    dynamicShouldError: false,
  } as WorkStore;
  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(store, () =>
      withSharedLegacySession(middleware, environment)(
        request,
        {} as NextFetchEvent,
      ),
    ),
  ) as Promise<Response>;
}

function sharedValue(response: Response) {
  return response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${SHARED_SESSION_COOKIE}=`))
    ?.split(";", 1)[0]
    .slice(SHARED_SESSION_COOKIE.length + 1);
}

test("installed SDK sees restored cookies through real Next headers and cookies stores", async () => {
  const response = await callSdk("/", original);
  expect(response.headers.get("x-middleware-request-cookie")).toContain(
    original.token,
  );
});

test.each([
  { label: "signed-out marker", previous: null },
  { label: "previous account", previous: original },
])(
  "cross-site OAuth callback replaces the shared $label with the verified session",
  async ({ previous }) => {
    const signedIn = { token: jwt(), refreshToken: "new-oauth-refresh" };
    backend.fetchAction.mockResolvedValueOnce({ tokens: signedIn });
    const response = await callSdk(
      "/?code=verified-oauth-code",
      previous,
      undefined,
      {
        accept: "text/html",
        "sec-fetch-site": "cross-site",
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://forum.symbaiex.com/",
    );
    expect(backend.fetchAction.mock.calls.at(-1)?.[1]).toMatchObject({
      params: { code: "verified-oauth-code" },
    });
    expect(sharedValue(response)).toBeDefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(
      await unsealSharedSession(sharedValue(response)!, environment),
    ).toMatchObject({ session: signedIn });
  },
);

test("failed cross-site OAuth callback does not overwrite a shared session", async () => {
  backend.fetchAction.mockResolvedValueOnce({ tokens: null });
  const response = await callSdk(
    "/?code=rejected-oauth-code",
    original,
    undefined,
    {
      accept: "text/html",
      "sec-fetch-site": "cross-site",
    },
  );

  expect(response.status).toBe(307);
  expect(sharedValue(response)).toBeUndefined();
  expect(
    response.headers
      .getSetCookie()
      .some((cookie) => cookie.startsWith(`${tokenName}=`)),
  ).toBe(true);
});

test.each(["/api/plugin/mcp", "/agent-auth/token", "/api/agent/auth/register"])(
  "stateless %s skips the installed SDK even with expired ambient cookies",
  async (path) => {
    backend.fetchAction.mockClear();
    backend.fetchQuery.mockClear();
    const expired = { token: jwt(-120), refreshToken: "must-not-refresh" };
    const cookie = `${SHARED_SESSION_COOKIE}=${await sealSharedSession(original, environment)}; ${tokenName}=${expired.token}; ${refreshName}=${expired.refreshToken}`;
    const request = new NextRequest(`https://forum.symbaiex.com${path}`, {
      method: "POST",
      headers: {
        host: "forum.symbaiex.com",
        origin: "https://chatgpt.com",
        authorization: "Bearer remote-resource-token",
        cookie,
      },
    });
    const humanHandler = vi.fn(() => NextResponse.next());
    const middleware = convexAuthNextjsMiddleware(humanHandler, {
      convexUrl: environment.NEXT_PUBLIC_CONVEX_URL,
    });
    const stateless = vi.fn((forwarded: NextRequest) => {
      expect(forwarded.headers.get("cookie")).toBe(cookie);
      expect(forwarded.headers.get("authorization")).toBe(
        "Bearer remote-resource-token",
      );
      return NextResponse.next();
    });
    const response = (await withSharedLegacySession(
      middleware,
      environment,
      stateless,
    )(request, {} as NextFetchEvent)) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(stateless).toHaveBeenCalledOnce();
    expect(humanHandler).not.toHaveBeenCalled();
    expect(backend.fetchAction).not.toHaveBeenCalled();
    expect(backend.fetchQuery).not.toHaveBeenCalled();
  },
);

test("installed SDK refresh endpoint keeps refresh values server-only and shares rotated cookies", async () => {
  const rotated = {
    token: jwt(7_200),
    refreshToken: "rotated-server-only-refresh",
  };
  backend.fetchAction.mockResolvedValueOnce({ tokens: rotated });
  const response = await callSdk("/api/auth", original, {
    action: "auth:signIn",
    args: { refreshToken: "dummy" },
  });
  expect(backend.fetchAction.mock.calls.at(-1)?.[1]).toMatchObject({
    refreshToken: original.refreshToken,
  });
  expect(await response.json()).toEqual({
    tokens: { token: rotated.token, refreshToken: "dummy" },
  });
  expect(
    await unsealSharedSession(sharedValue(response)!, environment),
  ).toMatchObject({ session: rotated });
  for (const cookie of response.headers
    .getSetCookie()
    .filter((value) => value.startsWith("__Host-")))
    expect(cookie).not.toContain("Domain=");
});

test("installed SDK automatically refreshes expired access tokens before forwarding sibling requests", async () => {
  const expired = {
    token: jwt(-120),
    refreshToken: "expired-access-live-refresh",
  };
  const rotated = {
    token: jwt(7_200),
    refreshToken: "automatic-rotated-refresh",
  };
  backend.fetchAction.mockResolvedValueOnce({ tokens: rotated });
  const response = await callSdk("/", expired);
  expect(backend.fetchAction.mock.calls.at(-1)?.[1]).toMatchObject({
    refreshToken: expired.refreshToken,
  });
  expect(response.headers.get("x-middleware-request-cookie")).toContain(
    rotated.token,
  );
  expect(
    await unsealSharedSession(sharedValue(response)!, environment),
  ).toMatchObject({ session: rotated });
});

test("installed SDK sign-out revokes the actual session and creates a shared signed-out marker", async () => {
  backend.fetchAction.mockResolvedValueOnce(null);
  const response = await callSdk("/api/auth", original, {
    action: "auth:signOut",
    args: {},
  });
  expect(backend.fetchAction.mock.calls.at(-1)?.[2]).toMatchObject({
    token: original.token,
  });
  expect(await response.json()).toBeNull();
  expect(
    await unsealSharedSession(sharedValue(response)!, environment),
  ).toMatchObject({ session: null });
});
