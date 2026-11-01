import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { reportReceipt } from "../tests/e2e/fixtures/research-report-view";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  action: vi.fn(),
  cookie: vi.fn(),
  setAuth: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./server-convex-auth", () => ({
  getAuthenticatedServerConvexClient: mocks.cookie,
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = mocks.query;
    action = mocks.action;
    setAuth = mocks.setAuth;
  },
}));
import { researchReportViewHttp } from "./forum-research-http";
import * as platform from "../apps/platform/app/api/research/token/[intentKey]/view/route";
import * as forum from "../apps/forum/app/api/research/token/[intentKey]/view/route";
import { NextRequest } from "next/server";
import { sendResponse } from "next/dist/server/send-response";
const key = reportReceipt.intentKey;
const request = (options?: RequestInit, query = "") =>
  new Request(
    `https://forum.symbaiex.com/api/research/token/${key}/view${query}`,
    options,
  );
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://inert.convex.cloud");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden");
    }),
  );
  mocks.query
    .mockReset()
    .mockResolvedValue({ ...reportReceipt, state: "fulfilled" });
  mocks.action.mockReset().mockImplementation(() => {
    throw new Error("Actions forbidden");
  });
  mocks.cookie
    .mockReset()
    .mockResolvedValue({ query: mocks.query, action: mocks.action });
  mocks.setAuth.mockReset();
});
afterEach(() => {
  expect(mocks.action).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe(
    "Cookie, Authorization, PAYMENT-SIGNATURE",
  );
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("content-security-policy")).toContain(
    "script-src 'none'",
  );
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.has("payment-required")).toBe(false);
  expect(response.headers.has("payment-response")).toBe(false);
}
test("fulfilled owner report uses exactly one status query, even after the original quote expired", async () => {
  const response = await researchReportViewHttp(request(), key);
  expect(response.status).toBe(200);
  privateResponse(response);
  expect(await response.text()).toContain("$0.0000000001");
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(getFunctionName(mocks.query.mock.calls[0][0])).toBe(
    "forumResearch:status",
  );
  expect(mocks.query.mock.calls[0][1]).toEqual({ intentKey: key });
});
test.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])(
  "%s is rejected before authentication or reads",
  async (method) => {
    const response = await researchReportViewHttp(request({ method }), key);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    privateResponse(response);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
  },
);
test.each(["", "untrusted-payment"])(
  "payment header never delegates to settlement (%s)",
  async (value) => {
    const response = await researchReportViewHttp(
      request({ headers: { "PAYMENT-SIGNATURE": value } }),
      key,
    );
    expect(response.status).toBe(403);
    privateResponse(response);
    expect(mocks.query).not.toHaveBeenCalled();
  },
);
test("invalid ID, guest, other owner and backend failures reveal no report fragments", async () => {
  expect((await researchReportViewHttp(request(), "invalid")).status).toBe(404);
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.cookie.mockResolvedValueOnce(null);
  const guest = await researchReportViewHttp(
    request(undefined, "?owner=trusted&token=fiction"),
    key,
  );
  expect(guest.status).toBe(401);
  privateResponse(guest);
  for (const reason of [
    "Not owned by actual principal",
    "private backend error with secret",
  ]) {
    mocks.query.mockRejectedValueOnce(new Error(reason));
    const response = await researchReportViewHttp(
      request({ headers: { host: "owner.example", "x-owner": "fiction" } }),
      key,
    );
    expect(response.status).toBe(409);
    privateResponse(response);
    const html = await response.text();
    expect(html).not.toContain(reason);
    expect(html).not.toContain(reportReceipt.mint);
  }
});
test("bearer syntax still delegates actual ownership to the existing status query", async () => {
  mocks.query.mockRejectedValueOnce(new Error("Wrong actual owner"));
  const response = await researchReportViewHttp(
    request({ headers: { authorization: `Bearer ${"a".repeat(30)}` } }),
    key,
  );
  expect(response.status).toBe(409);
  expect(mocks.setAuth).toHaveBeenCalledWith("a".repeat(30));
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.cookie).not.toHaveBeenCalled();
});
test.each([
  "quoted",
  "expired",
  "rejected",
  "unknown",
  "verifying",
  "settlement_claimed",
])(
  "%s remains generic, readonly, and cannot disclose a report",
  async (state) => {
    mocks.query.mockResolvedValueOnce({ ...reportReceipt, state });
    const response = await researchReportViewHttp(request(), key);
    expect(response.status).toBe(
      ["unknown", "verifying", "settlement_claimed"].includes(state)
        ? 202
        : 409,
    );
    privateResponse(response);
    expect(await response.text()).not.toContain(reportReceipt.mint);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  },
);
test.each([
  { report: null },
  { signature: null },
  { intentKey: "b".repeat(64) },
  { report: { ...reportReceipt.report, mint: "other" } },
  { report: { ...reportReceipt.report, product: "other" } },
])("inconsistent fulfilled metadata fails closed: %j", async (patch) => {
  mocks.query.mockResolvedValueOnce({
    ...reportReceipt,
    state: "fulfilled",
    ...patch,
  });
  const response = await researchReportViewHttp(request(), key);
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain(reportReceipt.mint);
});
test("both real route wrappers preserve the read-only method and private response contract", async () => {
  expect(platform.dynamic).toBe("force-dynamic");
  expect(platform.runtime).toBe("nodejs");
  for (const route of [platform, forum]) {
    const response = await route.GET(request(), {
      params: Promise.resolve({ intentKey: key }),
    });
    expect(response.status).toBe(200);
    privateResponse(response);
    const rejected = await route.POST(request({ method: "POST" }), {
      params: Promise.resolve({ intentKey: key }),
    });
    expect(rejected.status).toBe(405);
  }
  expect(mocks.query).toHaveBeenCalledTimes(2);
});

test("installed Next header merge retains actual proxy CSP while early meta and nonce preserve strict reader policy", async () => {
  vi.stubEnv("NEXT_PUBLIC_BETTER_AUTH_ENABLED", "true");
  vi.stubEnv("NODE_ENV", "production");
  const proxy = (await import("../proxy")).default as (
    request: NextRequest,
  ) => Promise<Response> | Response;
  const middleware = await proxy(new NextRequest(request().url));
  const nonce = middleware.headers.get("x-middleware-request-x-nonce")!;
  expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  const response = await researchReportViewHttp(
    request({ headers: { "x-nonce": nonce } }),
    key,
  );
  const headers = new Map<string, unknown>();
  // Same middleware outbound-header seeding as installed router-server.
  for (const name of [
    "content-security-policy",
    "referrer-policy",
    "x-frame-options",
  ])
    headers.set(name, middleware.headers.get(name));
  const end = vi.fn();
  const nodeResponse = {
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    appendHeader: (name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    },
    originalResponse: { end },
  };
  // HEAD transport suppresses the body only: actual installed header-merge path.
  await sendResponse(
    { method: "HEAD" } as Parameters<typeof sendResponse>[0],
    nodeResponse as unknown as Parameters<typeof sendResponse>[1],
    response,
  );
  expect(headers.get("content-security-policy")).toBe(
    middleware.headers.get("content-security-policy"),
  );
  expect(headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
  expect(headers.get("x-frame-options")).toBe("DENY");
  expect(headers.get("cache-control")).toBe("private, no-store");
  const html = await response.text();
  expect(html).toContain(`<style nonce="${nonce}">`);
  expect(html).toContain("script-src &#39;none&#39;");
  expect(html).toContain('name="referrer" content="no-referrer"');
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledTimes(1);
});
