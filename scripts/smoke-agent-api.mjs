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
  await request("GET", "/v1/status", null, null, 401);
  await request(
    "POST",
    "/mcp",
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    null,
    401,
  );
  console.log(
    JSON.stringify({
      mode: "public",
      baseUrl,
      manifest: "ok",
      openapi: "ok",
      unauthenticatedRest: 401,
      unauthenticatedMcp: 401,
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
    const denied = await request("GET", "/v1/status", null, authorization, 403);
    assert(
      /scope|active agent identity/i.test(String(denied?.error ?? "")),
      "The denial did not come from the expected agent scope boundary.",
    );
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
  const mcp = await request(
    "POST",
    "/mcp",
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    authorization,
    200,
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
  console.log(
    JSON.stringify({
      mode: "authenticated",
      baseUrl,
      agentId: session.agentId ?? "unknown",
      refreshed: Boolean(args.refresh),
      rest: results,
      mcp: 200,
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
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body !== null ? { "content-type": "application/json" } : {}),
      ...(authorization !== null ? { authorization } : {}),
      ...(idempotent
        ? { "idempotency-key": `smoke-${Date.now()}-${randomUUID()}` }
        : {}),
    },
    body: body === null ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null);
  assert(
    response.status === expectedStatus,
    `${method} ${path || "/"} returned ${response.status}; expected ${expectedStatus}.`,
  );
  return payload;
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
