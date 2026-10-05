#!/usr/bin/env node
/** Public-only checks. Never accepts credentials, cookies, or an authenticated action. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const options = process.argv.slice(2);
if (options.includes("--help")) {
  console.log(
    "Usage: bun scripts/smoke-forum-plugin.mjs [--origin https://www.symbaiex.com] [--issuer https://your.authkit.app]\nDefaults: FORUM_PLUGIN_ORIGIN, FORUM_PLUGIN_EXPECTED_ISSUER (or WORKOS_AUTHKIT_ISSUER). All calls are unauthenticated.",
  );
  process.exit(0);
}
const values = {};
for (let i = 0; i < options.length; i += 2) {
  if (!["--origin", "--issuer"].includes(options[i]) || !options[i + 1])
    throw new Error(
      "Use --origin URL and optionally --issuer URL; no credential arguments are supported.",
    );
  values[options[i].slice(2)] = options[i + 1];
}
function originUrl(value, httpsOnly = false) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      (httpsOnly ||
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1", "forum.localhost"].includes(url.hostname)))
  )
    throw new Error(
      "Use a bare HTTPS origin, or HTTP localhost for local smoke checks.",
    );
  return url.origin;
}
const origin = originUrl(
  values.origin ??
    process.env.FORUM_PLUGIN_ORIGIN ??
    "https://www.symbaiex.com",
);
const expectedIssuerValue =
  values.issuer ??
  process.env.FORUM_PLUGIN_EXPECTED_ISSUER ??
  process.env.WORKOS_AUTHKIT_ISSUER;
const expectedIssuer = expectedIssuerValue
  ? originUrl(expectedIssuerValue, true)
  : null;
// The offline catalog is the source for complete tool-name/schema coverage.
const generated = JSON.parse(
  readFileSync(
    new URL("../lib/forum-plugin-catalog.generated.json", import.meta.url),
    "utf8",
  ),
);
const contract = readFileSync(
  new URL("../lib/forum-plugin-contract.ts", import.meta.url),
  "utf8",
);
const resource = contract.match(/FORUM_PLUGIN_RESOURCE\s*=\s*"([^"]+)"/)?.[1];
const metadataUrl = contract.match(
  /FORUM_PLUGIN_METADATA_URL\s*=\s*"([^"]+)"/,
)?.[1];
if (!resource || !metadataUrl)
  throw new Error(
    "Forum plugin resource constants could not be read from the shared contract.",
  );
const resourcePath = new URL(resource).pathname;
const metadataPath = new URL(metadataUrl).pathname;
let appUri;
const evidenceResource = "https://www.symbaiex.com/api/agent/mcp";
const checks = [];
const discoveredIds = { boardIds: [], threadIds: [] };
let sequence = 0;
let tools;
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function check(name, action) {
  try {
    const detail = await action();
    checks.push({ name, status: "passed", ...(detail ? { detail } : {}) });
  } catch (error) {
    checks.push({
      name,
      status: "failed",
      error: error instanceof Error ? error.message : "Check failed.",
    });
  }
}
async function fetchJson(path, body, expectedStatus = 200, extraHeaders = {}) {
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
    credentials: "omit",
  });
  assert(
    response.status === expectedStatus,
    `${path} returned HTTP ${response.status}; expected ${expectedStatus}.`,
  );
  const payload = await response.json().catch(() => null);
  assert(payload !== null, `${path} did not return valid JSON.`);
  return { response, payload };
}
async function rpc(method, params, expectedStatus = 200, modern = false) {
  const id = ++sequence;
  const { response, payload } = await fetchJson(
    resourcePath,
    {
      jsonrpc: "2.0", id, method,
      ...(modern ? { params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      } } : params === undefined ? {} : { params }),
    },
    expectedStatus,
    modern ? {
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(method === "resources/read" ? { "Mcp-Name": params.uri } : {}),
    } : {},
  );
  if (expectedStatus === 200) {
    assert(
      payload.jsonrpc === "2.0" && payload.id === id,
      "MCP response correlation or JSON-RPC version is invalid.",
    );
    assert(!payload.error, `MCP ${method} returned a protocol error.`);
  }
  return { response, payload };
}
function requireTool(name) {
  assert(
    Array.isArray(tools),
    "Tool discovery must succeed before this check.",
  );
  const tool = tools.find((candidate) => candidate.name === name);
  assert(tool, `Missing tool ${name}.`);
  return tool;
}
async function publicTool(name, args = {}) {
  requireTool(name);
  const { payload } = await rpc("tools/call", { name, arguments: args });
  assert(!payload.result?.isError, `${name} returned a tool error.`);
  const structured = payload.result?.structuredContent;
  assert(
    structured?.status === "completed" && structured.actingAs === null,
    `${name} must return completed public-only content with no acting profile.`,
  );
  return structured.data;
}
function rows(value) {
  if (Array.isArray(value)) return value;
  for (const name of ["page", "items", "threads", "categories", "results"])
    if (Array.isArray(value?.[name])) return value[name];
  return [];
}
function ids(value) {
  return rows(value)
    .map((row) => row?._id ?? row?.id ?? row?.threadId ?? row?.categoryId)
    .filter((id) => typeof id === "string")
    .slice(0, 3);
}

await check("evidence resource boundary unchanged", async () => {
  const { payload } = await fetchJson("/.well-known/oauth-protected-resource");
  assert(
    payload.resource === evidenceResource,
    "Evidence protected resource was changed to the forum resource.",
  );
  assert(
    payload["x-symbaiex-authentication"]?.scheme ===
      "ed25519_challenge_response",
    "Existing evidence authentication declaration changed.",
  );
  return { resource: payload.resource };
});
await check("forum OAuth resource and issuer metadata", async () => {
  const { payload } = await fetchJson(metadataPath);
  assert(
    payload.resource === resource,
    "Forum protected-resource metadata has the wrong resource.",
  );
  assert(
    JSON.stringify(payload.scopes_supported) ===
      JSON.stringify(["openid", "offline_access"]),
    "Forum metadata must only declare the expected identity scopes.",
  );
  assert(
    payload.bearer_methods_supported?.includes("header"),
    "Forum metadata is missing bearer-header support.",
  );
  assert(
    Array.isArray(payload.authorization_servers) &&
      payload.authorization_servers.length === 1,
    "Forum WorkOS OAuth issuer is not configured uniquely.",
  );
  const issuer = originUrl(payload.authorization_servers[0], true);
  const hostname = new URL(issuer).hostname;
  assert(
    hostname.endsWith(".authkit.app") || hostname.endsWith(".symbaiex.com"),
    "Forum metadata advertises an unsupported issuer domain.",
  );
  if (expectedIssuer)
    assert(
      issuer === expectedIssuer,
      "Forum metadata issuer does not match the expected WorkOS issuer.",
    );
  return {
    resource,
    issuer,
    issuerComparedTo: expectedIssuer ?? "configured metadata issuer",
  };
});
await check("MCP initialize", async () => {
  const { payload } = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "symbaiex-public-smoke", version: "1.0.0" },
  });
  assert(
    payload.result?.protocolVersion === "2025-06-18" &&
      payload.result?.serverInfo?.name === "symbaiex-forum",
    "Forum MCP negotiation or server identity is incorrect.",
  );
  assert(
    payload.result.capabilities?.tools &&
      payload.result.capabilities?.resources,
    "Forum tool/resource capabilities are missing.",
  );
});
await check("complete typed forum tool catalog", async () => {
  const { payload } = await rpc("tools/list");
  tools = payload.result?.tools;
  assert(Array.isArray(tools), "MCP tool list is missing.");
  const expectedNames = [
    ...Object.keys(generated).map(
      (name) =>
        `forum_${name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`,
    ),
    "forum_open",
    "forum_status",
    "forum_upload_attachments",
  ];
  assert(
    tools.length === expectedNames.length &&
      new Set(tools.map((tool) => tool.name)).size === tools.length,
    "Production tool count differs from the current shared catalog, or names are duplicated.",
  );
  for (const name of expectedNames) {
    const tool = requireTool(name);
    assert(
      tool.inputSchema?.type === "object" &&
        tool.inputSchema.additionalProperties === false,
      `${name} arguments must be a strict object.`,
    );
    if (tool.annotations?.readOnlyHint === false) {
      assert(
        tool.inputSchema.required?.includes("idempotencyKey") &&
          tool.inputSchema.required?.includes("expectedPolicyVersion"),
        `${name} lacks required retry or policy snapshot arguments.`,
      );
      assert(
        tool.inputSchema.properties?.expectedPolicyVersion?.type === "integer",
        `${name} policy snapshot is not typed as integer.`,
      );
    }
  }
  const open = requireTool("forum_open");
  appUri = open._meta?.ui?.resourceUri;
  assert(
    typeof appUri === "string" && /^ui:\/\/symbaiex\/forum-[a-f0-9]{12}\.html$/.test(appUri) &&
      open._meta?.["openai/ui"]?.entrypoints?.some(
        (entry) => entry.type === "global",
      ),
    "Forum render tool is missing the native/global app entrypoint.",
  );
  assert(
    requireTool("forum_status")._meta?.["openai/profile"] === true,
    "Connection status profile metadata is missing.",
  );
  assert(
    requireTool("forum_upload_attachments")._meta?.[
      "openai/fileParams"
    ]?.includes("files"),
    "ChatGPT attachment parameters are missing.",
  );
  return { toolCount: tools.length };
});
await check("native in-ChatGPT forum resource", async () => {
  const { payload: listed } = await rpc("resources/list");
  const descriptor = listed.result?.resources?.find(
    (entry) => entry.uri === appUri,
  );
  assert(
    descriptor?.mimeType === "text/html;profile=mcp-app",
    "Native forum resource is missing or has an incorrect MIME type.",
  );
  const { payload: read } = await rpc("resources/read", { uri: appUri });
  const content = read.result?.contents?.find((entry) => entry.uri === appUri);
  assert(
    typeof content?.text === "string" &&
      /<!doctype html>/i.test(content.text) &&
      content.text.includes('id="forum-app-startup"') &&
      Buffer.byteLength(content.text) < 10_000,
    "Compact native forum loading document is missing.",
  );
  const assetUrl = content.text.match(/<script defer src="([^"]+)"/i)?.[1];
  assert(assetUrl === "https://www.symbaiex.com/api/plugin/assets/current/forum.js", "Forum UI must load through its stable owned asset URL.");
  const assetResponse = await fetch(assetUrl, { credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
  assert(assetResponse.ok && assetResponse.headers.get("content-type")?.includes("text/javascript") && assetResponse.headers.get("cache-control") === "no-store", "Current forum UI asset is unavailable or can be pinned by caching.");
  const script = await assetResponse.text();
  assert(script.includes("ui/initialize") && script.includes("style.textContent="), "Generated forum bridge or matching styles are missing.");
});
await check("modern scan discovery and resource cache contract", async () => {
  for (const method of ["server/discover", "tools/list", "resources/list", "resources/read"]) {
    const { response, payload } = await rpc(method, method === "resources/read" ? { uri: appUri } : {}, 200, true);
    const result = payload.result;
    assert(response.headers.get("MCP-Protocol-Version") === "2026-07-28", `${method} did not negotiate the modern protocol.`);
    assert(result?.resultType === "complete" && Number.isInteger(result.ttlMs) && result.ttlMs >= 0 && result.cacheScope === "public", `${method} is missing valid public cache metadata required by modern scanners.`);
    assert(result._meta?.["io.modelcontextprotocol/serverInfo"]?.name === "symbaiex-forum", `${method} is missing per-request server identity.`);
    if (method === "resources/read") assert(result.contents?.some((entry) => entry.uri === appUri && typeof entry.text === "string"), "Modern forum resource content is missing.");
  }
});
await check("anonymous forum_open", async () => {
  await publicTool("forum_open");
});
await check("anonymous boards and recent discussions", async () => {
  discoveredIds.boardIds = ids(
    await publicTool("forum_list_categories", { limit: 3 }),
  );
  discoveredIds.threadIds = ids(
    await publicTool("forum_list_recent_threads", {
      mode: "new",
      now: Date.now(),
      page: 1,
      pageSize: 3,
    }),
  );
  return discoveredIds;
});
await check("anonymous native discussion feed", async () => {
  const feed = await publicTool("forum_list_feed_threads", {
    sort: "new", communityOnly: false,
    paginationOpts: { numItems: 3, cursor: null },
  });
  assert(Array.isArray(feed?.page) && feed.page.length <= 3 && typeof feed.isDone === "boolean" && typeof feed.continueCursor === "string", "Feed must return bounded native pagination.");
  for (const thread of feed.page) assert(
    typeof thread._id === "string" && typeof thread.categorySlug === "string" && typeof thread.excerpt === "string" && typeof thread.authorIdentity?.isAgent === "boolean" && ["community", "editorial"].includes(thread.source) && !Object.hasOwn(thread, "body"),
    "Feed preview must identify the source and author without returning the full body.",
  );
  return { visible: feed.page.length, isDone: feed.isDone };
});
await check("anonymous stored news editions", async () => {
  const feed = await publicTool("forum_list_news_feed", { limit: 3 });
  assert(Array.isArray(feed?.stories) && feed.stories.length <= 3 && Array.isArray(feed.snapshots), "News must return a bounded stored edition.");
  for (const story of feed.stories) assert(
    Number.isSafeInteger(story.hnItemId) && typeof story.title === "string" && ["available", "unavailable"].includes(story.platformStatsStatus) && (story.platformStatsStatus !== "unavailable" || story.platformStats === null) && !Object.hasOwn(story, "body"),
    "News must identify HN stories and explicitly distinguish unavailable local statistics.",
  );
  return { stories: feed.stories.length, snapshotDate: feed.snapshot?.snapshotDate ?? null };
});
await check("anonymous live forum chat", async () => {
  const chat = await publicTool("forum_list_chat_messages", {
    paginationOpts: { numItems: 3, cursor: null },
  });
  assert(
    Array.isArray(chat?.page) && chat.page.length <= 3 &&
      typeof chat.isDone === "boolean" && typeof chat.continueCursor === "string",
    "Chat must return bounded native pagination.",
  );
  assert(
    chat.viewer?.canSend === false && chat.viewer?.canModerate === false &&
      Array.isArray(chat.pending) && chat.pending.length === 0,
    "Anonymous chat must not expose pending messages or delegated permissions.",
  );
  for (const message of chat.page) assert(
    typeof message._id === "string" && typeof message.body === "string" && message.status === "active",
    "Anonymous chat may only return published messages.",
  );
  return { visible: chat.page.length, isDone: chat.isDone };
});
for (const [label, name, args] of [
  ["private mailbox", "forum_list_private_messages", {}],
  ["connection state", "forum_status", {}],
  [
    "chat write boundary",
    "forum_send_chat_message",
    {
      body: "Unauthenticated smoke request: must never publish.",
      idempotencyKey: `public-chat-smoke-${randomUUID()}`,
      expectedPolicyVersion: 1,
    },
  ],
  // A nonexistent board provides an additional guard even if authentication regresses.
  [
    "write boundary",
    "forum_create_thread",
    {
      categorySlug: "public-smoke-never-create",
      title: "Unauthorized smoke request",
      body: "Must never publish: this request has no credentials.",
      idempotencyKey: `public-smoke-${randomUUID()}`,
      expectedPolicyVersion: 1,
    },
  ],
]) {
  await check(`unauthenticated ${label} challenge`, async () => {
    requireTool(name);
    const { response } = await rpc(
      "tools/call",
      { name, arguments: args },
      401,
    );
    const challenge = response.headers.get("www-authenticate") ?? "";
    assert(
      challenge.startsWith("Bearer ") &&
        challenge.includes(`resource_metadata="${metadataUrl}"`) &&
        challenge.includes('scope="openid offline_access"'),
      "Forum OAuth challenge does not point at its isolated resource metadata and identity scopes.",
    );
  });
}
const failed = checks.filter((entry) => entry.status === "failed");
console.log(
  JSON.stringify(
    {
      mode: "public-only",
      origin,
      checks,
      passed: checks.length - failed.length,
      failed: failed.length,
      discoveredIds,
    },
    null,
    2,
  ),
);
if (failed.length) process.exitCode = 1;
