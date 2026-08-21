#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(
  args["base-url"] ??
    process.env.SYMBAIEX_AGENT_API_BASE_URL ??
    "https://www.symbaiex.com/api/agent",
);

if (args["public-only"]) {
  await publicSmoke();
} else {
  await authenticatedSmoke();
}

async function publicSmoke() {
  const manifest = await request("GET", "", null, null, 200);
  assert(manifest?.version === "v1", "Manifest version is not v1.");
  assert(
    manifest?.monetization?.enabled === false,
    "Manifest unexpectedly enables payment processing.",
  );
  assert(
    manifest?.graphql?.enabled === false,
    "Manifest unexpectedly enables GraphQL.",
  );
  const openapi = await request("GET", "/openapi.json", null, null, 200);
  assert(
    openapi?.paths?.["/v1/entitlements"]?.get?.operationId ===
      "getEvidenceEntitlements",
    "OpenAPI entitlement operation is missing.",
  );
  const protectedResource = await request(
    "GET",
    `${new URL(baseUrl).origin}/.well-known/oauth-protected-resource`,
    null,
    null,
    200,
  );
  assert(
    protectedResource?.resource === "https://www.symbaiex.com/api/agent/mcp" &&
      protectedResource?.["x-symbaiex-authentication"]?.oauth2 === false,
    "Protected-resource metadata does not truthfully describe custom MCP authentication.",
  );
  const authenticationMetadata = await request(
    "GET",
    `${new URL(baseUrl).origin}/.well-known/symbaiex-agent-authentication`,
    null,
    null,
    200,
  );
  assert(
    authenticationMetadata?.protocol === "symbaiex_ed25519_challenge_v1" &&
      authenticationMetadata?.oauth2?.supported === false,
    "Custom agent authentication metadata is missing or overclaims OAuth support.",
  );
  await request("GET", "/v1/status", null, null, 401);
  const publicTools = await requestDetailed(
    "POST",
    "/mcp",
    modernMessage("tools/list", 1),
    null,
    200,
    false,
    modernHeaders("tools/list"),
  );
  assert(
    Array.isArray(publicTools.payload?.result?.tools) &&
      publicTools.payload.result.tools.some(
        (tool) => tool?.name === "evidence.search",
      ),
    "Public MCP discovery did not include evidence.search.",
  );
  const invalidBearer = await requestDetailed(
    "POST",
    "/mcp",
    modernMessage("tools/call", 2, {
      name: "evidence.status",
      arguments: {},
    }),
    "Bearer invalid-public-smoke-token",
    401,
    false,
    modernHeaders("tools/call", "evidence.status"),
  );
  assertAuthChallenge(invalidBearer.response, 401);
  assert(
    invalidBearer.response.headers
      .get("www-authenticate")
      ?.includes('error="invalid_token"'),
    "MCP invalid bearer response is missing invalid_token metadata.",
  );
  console.log(
    JSON.stringify({
      mode: "public",
      baseUrl,
      manifest: "ok",
      openapi: "ok",
      protectedResourceMetadata: "custom-ed25519",
      unauthenticatedRest: 401,
      publicMcpDiscovery: 200,
      invalidBearerMcpToolCall: 401,
      paymentAccepted: false,
      graphql: false,
    }),
  );
}

async function authenticatedSmoke() {
  const sessionPath = resolve(
    args.session ?? `${homedir()}/.config/symbaiex/agent-session.json`,
  );
  assertPrivateFile(sessionPath);
  let session = readJson(sessionPath);
  if (args.refresh) {
    assert(
      typeof session.refreshToken === "string",
      "Session does not include a refresh token.",
    );
    const refreshed = await request(
      "POST",
      "/auth/refresh",
      { refreshToken: session.refreshToken },
      null,
      200,
    );
    assert(
      typeof refreshed?.tokens?.token === "string" &&
        typeof refreshed?.tokens?.refreshToken === "string",
      "Refresh response did not include rotating tokens.",
    );
    session = {
      ...session,
      accessToken: refreshed.tokens.token,
      refreshToken: refreshed.tokens.refreshToken,
      expiresAt: refreshed.expiresAt,
      refreshedAt: new Date().toISOString(),
    };
    writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(sessionPath, 0o600);
  }
  assert(
    typeof session.accessToken === "string" && session.accessToken.length > 0,
    "Session does not include an access token.",
  );
  const authorization = `Bearer ${session.accessToken}`;
  if (args["expect-scope-denied"]) {
    const denied = await requestDetailed(
      "POST",
      "/mcp",
      modernMessage("tools/call", "scope-denied", {
        name: "evidence.status",
        arguments: {},
      }),
      authorization,
      403,
      false,
      modernHeaders("tools/call", "evidence.status"),
    );
    assert(
      /scope|active agent identity/i.test(String(denied.payload?.error ?? "")),
      "The denial did not come from the expected agent scope boundary.",
    );
    assertAuthChallenge(denied.response, 403);
    console.log(
      JSON.stringify({
        mode: "insufficient-scope",
        baseUrl,
        agentId: session.agentId ?? "unknown",
        evidenceStatus: 403,
      }),
    );
    return;
  }
  const checks = [
    ["status", "/v1/status"],
    ["quota", "/v1/quota"],
    ["entitlements", "/v1/entitlements"],
    ["usage", "/v1/usage?limit=5"],
    ["sources", "/v1/sources?limit=5"],
    ["search", "/v1/search?q=SYMBaiEX&limit=5"],
    ["changes", "/v1/changes?limit=5"],
    ["products", "/v1/products?limit=5"],
    ["datasets", "/v1/datasets?limit=5"],
    ["benchmarks", "/v1/benchmarks?limit=5"],
  ];
  const results = {};
  for (const [name, path] of checks) {
    await request("GET", path, null, authorization, 200, true);
    results[name] = 200;
  }
  const discovered = await request(
    "POST",
    "/mcp",
    modernMessage("server/discover", "smoke-discover"),
    authorization,
    200,
    false,
    modernHeaders("server/discover"),
  );
  assert(
    discovered?.result?.supportedVersions?.includes("2026-07-28") &&
      discovered?.result?._meta?.["io.modelcontextprotocol/serverInfo"]
        ?.name === "symbaiex-evidence",
    "MCP server/discover did not negotiate the modern protocol identity.",
  );
  const mcp = await request(
    "POST",
    "/mcp",
    modernMessage("tools/list", 1),
    authorization,
    200,
    false,
    modernHeaders("tools/list"),
  );
  const toolNames = Array.isArray(mcp?.result?.tools)
    ? mcp.result.tools.map((tool) => tool?.name)
    : [];
  assert(
    toolNames.includes("evidence.search"),
    "MCP evidence.search is missing.",
  );
  assert(
    toolNames.includes("evidence.entitlements"),
    "MCP evidence.entitlements is missing.",
  );
  assert(
    mcp?.result?.resultType === "complete" &&
      mcp?.result?.ttlMs >= 0 &&
      mcp?.result?.cacheScope === "public",
    "MCP tools/list is missing modern deterministic cache hints.",
  );
  console.log(
    JSON.stringify({
      mode: "authenticated",
      baseUrl,
      agentId: session.agentId ?? "unknown",
      refreshed: Boolean(args.refresh),
      rest: results,
      mcp: 200,
      mcpProtocol: "2026-07-28",
      mcpToolCount: toolNames.length,
    }),
  );
}

async function request(
  method,
  path,
  body,
  authorization,
  expectedStatus,
  idempotent = false,
  requestHeaders = {},
) {
  return (
    await requestDetailed(
      method,
      path,
      body,
      authorization,
      expectedStatus,
      idempotent,
      requestHeaders,
    )
  ).payload;
}

async function requestDetailed(
  method,
  path,
  body,
  authorization,
  expectedStatus,
  idempotent = false,
  requestHeaders = {},
) {
  const response = await fetch(
    /^https?:\/\//.test(path) ? path : `${baseUrl}${path}`,
    {
      method,
      headers: {
        accept: "application/json",
        ...(body !== null ? { "content-type": "application/json" } : {}),
        ...(authorization !== null ? { authorization } : {}),
        ...(idempotent
          ? { "idempotency-key": `smoke-${Date.now()}-${randomUUID()}` }
          : {}),
        ...requestHeaders,
      },
      body: body === null ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    },
  );
  const payload = await response.json().catch(() => null);
  assert(
    response.status === expectedStatus,
    `${method} ${path || "/"} returned ${response.status}; expected ${expectedStatus}.`,
  );
  return { payload, response };
}

function modernMessage(method, id, params = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          name: "symbaiex-smoke",
          version: "1.0.0",
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

function modernHeaders(method, name) {
  return {
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...(name === undefined ? {} : { "mcp-name": name }),
  };
}

function assertAuthChallenge(response, status) {
  const challenge = response.headers.get("www-authenticate") ?? "";
  assert(
    challenge.includes(
      'resource_metadata="https://www.symbaiex.com/.well-known/oauth-protected-resource"',
    ) && challenge.includes('scope="evidence"'),
    `MCP ${status} response is missing protected-resource scope metadata.`,
  );
  if (status === 403) {
    assert(
      challenge.includes('error="insufficient_scope"'),
      "MCP 403 response is missing insufficient_scope metadata.",
    );
  }
}

function assertPrivateFile(path) {
  const mode = statSync(path).mode & 0o777;
  assert(
    (mode & 0o077) === 0,
    `Refusing to read ${path}; session files must not be group/world accessible.`,
  );
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${path}: ${error instanceof Error ? error.message : "invalid JSON"}`,
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Agent API base URL must be a valid absolute URL.");
  }
  assert(
    !url.username && !url.password && !url.search && !url.hash,
    "Agent API base URL must not contain credentials, a query, or a fragment.",
  );
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  assert(
    url.protocol === "https:" || localHttp,
    "Agent API base URL must use HTTPS, except for localhost smoke tests.",
  );
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (
      value === "--public-only" ||
      value === "--expect-scope-denied" ||
      value === "--refresh"
    ) {
      result[value.slice(2)] = true;
    } else if (value.startsWith("--")) {
      result[value.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return result;
}
