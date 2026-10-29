#!/usr/bin/env node

import { PRIMARY_SITE_URL } from "../lib/site-urls.ts";

import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(
  args["base-url"] ??
    process.env.SYMBAIEX_AGENT_API_BASE_URL ??
    PRIMARY_SITE_URL + "/api/agent",
);

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (args["public-only"]) await publicSmoke();
  else await authenticatedSmoke();
}

export async function publicSmoke() {
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
    protectedResource?.resource === PRIMARY_SITE_URL + "/api/agent/mcp" &&
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
      authenticationMetadata?.protocol_type === "custom",
    "Custom agent authentication metadata does not identify the Ed25519 protocol.",
  );
  const oauth = manifest?.authentication?.oauth2;
  if (oauth && typeof oauth === "object") {
    const issuer = new URL(oauth.issuer);
    assert(
      issuer.protocol === "https:" &&
        !issuer.username && !issuer.password && !issuer.search && !issuer.hash,
      "OAuth issuer must be an HTTPS URL without credentials, query or fragment.",
    );
    // RFC 8414 discovery belongs to the advertised issuer. The site endpoint
    // can redirect to WorkOS; credential-bearing requests still reject redirects.
    const metadataUrl = new URL(
      `/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/, "")}`,
      issuer,
    );
    const metadata = await request(
      "GET",
      metadataUrl.href,
      null,
      null,
      200,
    );
    assert(
      metadata?.issuer === oauth.issuer &&
        protectedResource?.authorization_servers?.includes(metadata.issuer) &&
        metadata?.code_challenge_methods_supported?.includes("S256") &&
        metadata?.response_types_supported?.includes("code"),
      "OAuth issuer discovery or PKCE support is inconsistent.",
    );
  } else {
    assert(
      !protectedResource?.authorization_servers?.length,
      "OAuth provider is advertised without matching manifest support.",
    );
  }
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
        (tool) => tool?.name === "evidence_search",
      ),
    "Public MCP discovery did not include evidence_search.",
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
  await assertAuthChallenge(invalidBearer.response, 401, protectedResource);
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
      protectedResourceMetadata: oauth ? "ed25519-and-oauth" : "custom-ed25519",
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
    await assertAuthChallenge(denied.response, 403);
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
    toolNames.includes("evidence_search"),
    "MCP evidence_search is missing.",
  );
  assert(
    toolNames.includes("evidence_entitlements"),
    "MCP evidence_entitlements is missing.",
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

async function assertAuthChallenge(response, status, protectedResource) {
  protectedResource ??= await request(
    "GET",
    `${new URL(baseUrl).origin}/.well-known/oauth-protected-resource`,
    null,
    null,
    200,
  );
  const challenge = response.headers.get("www-authenticate") ?? "";
  const scopes = protectedResource?.scopes_supported;
  const challengeScopes = challenge.match(/\bscope="([^"]+)"/)?.[1].split(" ");
  assert(
    challenge.includes(
      "resource_metadata=\"" + PRIMARY_SITE_URL + "/.well-known/oauth-protected-resource\"",
    ) &&
      Array.isArray(scopes) &&
      scopes.length > 0 &&
      // RFC 9728 section 7.2: supported scopes are not all required scopes.
      // Distinct issuers may authorize this resource using different subsets.
      challengeScopes?.length > 0 &&
      challengeScopes.every((scope) => scopes.includes(scope)),
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
