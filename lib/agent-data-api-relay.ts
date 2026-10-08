import { createHash, randomUUID } from "node:crypto";
import { agentBearerChallenge } from "./agent-auth-metadata";
import { validateWorkOSAgentRegistrationCredential } from "./workos-agent-registration";

export const AGENT_DATA_MAX_BODY_BYTES = 32 * 1024;
export const AGENT_DATA_MAX_RESPONSE_BYTES = 1024 * 1024;
export const AGENT_DATA_OPERATIONS = [
  "status",
  "sources",
  "source_registry",
  "search",
  "semantic_search",
  "universal_search",
  "document",
  "changes",
  "verify",
  "entities",
  "version_claims",
  "claim_timeline",
  "products",
  "datasets",
  "dataset_versions",
  "dataset_version_diff",
  "dataset_version_artifact",
  "dataset_version_manifest",
  "benchmarks",
  "quota",
  "entitlements",
  "usage",
  "research_create",
  "research_get",
  "research_artifact",
  "export_create",
  "export_get",
  "export_artifact",
  "export_manifest",
  "webhooks_list",
  "webhooks_availability",
  "webhooks_create",
  "webhooks_status",
  "webhooks_health",
  "webhooks_history",
  "webhooks_rotate",
  "webhooks_replay",
  "webhooks_test",
] as const;
export type AgentDataOperation = (typeof AGENT_DATA_OPERATIONS)[number];
export type AgentArtifactKind =
  | "research"
  | "export"
  | "export-manifest"
  | "dataset-version"
  | "dataset-version-manifest";

const ALLOWED_ORIGINS = new Set([
  "https://symbaiex.com",
  "https://www.symbaiex.com",
  "https://forum.symbaiex.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
]);

const AGENT_RATE_LIMIT_POLICY = '"agent-minute";q=60;w=60';
const API_LIFECYCLE_URL = "https://www.symbaiex.com/developers/api-lifecycle";

export function isAllowedAgentOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return ALLOWED_ORIGINS.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function agentDataHeaders(
  request: Request,
  contentType = "application/json",
) {
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, content-type, idempotency-key, mcp-protocol-version, mcp-method, mcp-name",
    "Access-Control-Expose-Headers":
      "www-authenticate, mcp-server-name, mcp-server-version, x-artifact-sha256, content-length, content-disposition, ratelimit, ratelimit-policy, retry-after, location, link",
    "RateLimit-Policy": AGENT_RATE_LIMIT_POLICY,
    Link: `<${API_LIFECYCLE_URL}>; rel="deprecation"`,
  });
  const origin = request.headers.get("origin");
  if (origin && isAllowedAgentOrigin(request))
    headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

export function agentDataJson(
  request: Request,
  payload: unknown,
  status: number,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: agentDataHeaders(request),
  });
}

export function bearer(request: Request) {
  const value = request.headers.get("authorization")?.trim() ?? "";
  return /^Bearer\s+\S+$/i.test(value) ? value : null;
}

export function mapRestRequest(
  method: string,
  segments: string[],
  search: URLSearchParams,
  body: Record<string, unknown> = {},
): { operation: AgentDataOperation; input: Record<string, unknown> } | null {
  const limit = parseLimit(search.get("limit"));
  if ("invalid" in limit) return null;
  const only = (allowed: string[]) =>
    [...search.keys()].every((key) => allowed.includes(key));
  if (
    method === "GET" &&
    segments.length === 5 &&
    segments[0] === "datasets" &&
    segments[2] === "versions" &&
    (segments[4] === "artifact" || segments[4] === "manifest") &&
    validText(segments[1]) &&
    validText(segments[3]) &&
    only([])
  )
    return {
      operation:
        segments[4] === "artifact"
          ? "dataset_version_artifact"
          : "dataset_version_manifest",
      input: { datasetId: segments[1], versionId: segments[3] },
    };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "status" &&
    only([])
  )
    return { operation: "status", input: {} };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "sources" &&
    only(["limit"])
  )
    return { operation: "sources", input: limit };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "source-registry" &&
    only([])
  )
    return { operation: "source_registry", input: {} };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "search" &&
    only(["q", "limit"]) &&
    validText(search.get("q"))
  )
    return { operation: "search", input: { query: search.get("q"), ...limit } };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "universal-search" &&
    only(["q", "limit"]) &&
    validText(search.get("q"))
  )
    return {
      operation: "universal_search",
      input: { query: search.get("q"), ...limit },
    };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "semantic-search" &&
    only(["q", "limit"]) &&
    validText(search.get("q")) &&
    (limit.limit === undefined || Number(limit.limit) <= 20)
  )
    return {
      operation: "semantic_search",
      input: {
        query: search.get("q")!.replace(/\s+/g, " ").trim(),
        limit: limit.limit ?? 10,
      },
    };
  if (
    method === "GET" &&
    segments.length === 2 &&
    segments[0] === "documents" &&
    only([]) &&
    validText(segments[1])
  )
    return { operation: "document", input: { documentId: segments[1] } };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "changes" &&
    only(["limit"])
  )
    return { operation: "changes", input: limit };
  if (
    method === "GET" &&
    segments.length === 1 &&
    ["products", "datasets", "benchmarks"].includes(segments[0]!) &&
    only(["limit"])
  )
    return { operation: segments[0] as AgentDataOperation, input: limit };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "quota" &&
    only([])
  )
    return { operation: "quota", input: {} };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "entitlements" &&
    only([])
  )
    return { operation: "entitlements", input: {} };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "usage" &&
    only(["limit"])
  )
    return { operation: "usage", input: limit };
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "datasets" &&
    segments[2] === "versions" &&
    validText(segments[1]) &&
    only(["limit", "cursor"])
  ) {
    const cursor = search.get("cursor");
    if (cursor !== null && (!cursor || cursor.length > 512)) return null;
    return {
      operation: "dataset_versions",
      input: {
        datasetId: segments[1],
        ...limit,
        ...(cursor === null ? {} : { cursor }),
      },
    };
  }
  if (
    method === "GET" &&
    segments.length === 5 &&
    segments[0] === "datasets" &&
    segments[2] === "versions" &&
    segments[4] === "diff" &&
    validText(segments[1]) &&
    validText(segments[3]) &&
    only(["against"])
  ) {
    const againstVersionId = search.get("against");
    if (againstVersionId !== null && !validText(againstVersionId)) return null;
    return {
      operation: "dataset_version_diff",
      input: {
        datasetId: segments[1],
        versionId: segments[3],
        ...(againstVersionId === null ? {} : { againstVersionId }),
      },
    };
  }
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "claims" &&
    segments[2] === "verify" &&
    only([]) &&
    validText(segments[1])
  )
    return { operation: "verify", input: { claimId: segments[1] } };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "entities" &&
    only(["q", "limit"]) &&
    validText(search.get("q"))
  )
    return {
      operation: "entities",
      input: { query: search.get("q"), ...limit },
    };
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "document-versions" &&
    segments[2] === "claims" &&
    only(["limit"]) &&
    validText(segments[1])
  )
    return {
      operation: "version_claims",
      input: { documentVersionId: segments[1], ...limit },
    };
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "claims" &&
    segments[2] === "timeline" &&
    only(["limit"]) &&
    validText(segments[1])
  )
    return {
      operation: "claim_timeline",
      input: { claimKey: segments[1], ...limit },
    };
  if (
    method === "POST" &&
    segments.length === 1 &&
    segments[0] === "research-jobs" &&
    only([]) &&
    onlyBody(body, ["query"]) &&
    validText(body.query)
  )
    return { operation: "research_create", input: { query: body.query } };
  if (
    method === "GET" &&
    segments.length === 2 &&
    segments[0] === "research-jobs" &&
    only([]) &&
    validText(segments[1])
  )
    return { operation: "research_get", input: { jobId: segments[1] } };
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "research-jobs" &&
    segments[2] === "artifact" &&
    only([]) &&
    validText(segments[1])
  )
    return { operation: "research_artifact", input: { jobId: segments[1] } };
  if (
    method === "POST" &&
    segments.length === 1 &&
    segments[0] === "exports" &&
    only([]) &&
    onlyBody(body, [
      "datasetId",
      "format",
      "recordLimit",
      "selectionStrategy",
      "cursor",
    ]) &&
    validText(body.datasetId) &&
    (body.format === undefined ||
      body.format === "jsonl" ||
      body.format === "parquet") &&
    (body.selectionStrategy === undefined ||
      body.selectionStrategy === "balanced" ||
      body.selectionStrategy === "recent") &&
    (body.cursor === undefined || validText(body.cursor)) &&
    (body.recordLimit === undefined ||
      (Number.isSafeInteger(body.recordLimit) &&
        (body.recordLimit as number) >= 1 &&
        (body.recordLimit as number) <= 500))
  )
    return {
      operation: "export_create",
      input: {
        datasetId: body.datasetId,
        format: body.format ?? "jsonl",
        recordLimit: body.recordLimit ?? 100,
        ...(body.selectionStrategy === undefined
          ? {}
          : { selectionStrategy: body.selectionStrategy }),
        ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
      },
    };
  if (
    method === "GET" &&
    segments.length === 2 &&
    segments[0] === "exports" &&
    only([]) &&
    validText(segments[1])
  )
    return { operation: "export_get", input: { jobId: segments[1] } };
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "exports" &&
    segments[2] === "artifact" &&
    only([]) &&
    validText(segments[1])
  )
    return { operation: "export_artifact", input: { jobId: segments[1] } };
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "exports" &&
    segments[2] === "manifest" &&
    only([]) &&
    validText(segments[1])
  )
    return { operation: "export_manifest", input: { jobId: segments[1] } };
  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "webhooks" &&
    only([])
  )
    return { operation: "webhooks_list", input: {} };
  if (
    method === "GET" &&
    segments.length === 2 &&
    segments[0] === "webhooks" &&
    segments[1] === "availability" &&
    only([])
  )
    return { operation: "webhooks_availability", input: {} };
  if (
    method === "POST" &&
    segments.length === 1 &&
    segments[0] === "webhooks" &&
    only([]) &&
    onlyBody(body, ["subscriptionKey", "url", "eventTypes"]) &&
    validText(body.subscriptionKey) &&
    validText(body.url) &&
    Array.isArray(body.eventTypes)
  )
    return { operation: "webhooks_create", input: body };
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "webhooks" &&
    segments[2] === "status" &&
    only([]) &&
    onlyBody(body, ["status"]) &&
    validText(segments[1]) &&
    ["active", "paused", "revoked"].includes(String(body.status))
  )
    return {
      operation: "webhooks_status",
      input: { subscriptionKey: segments[1], status: body.status },
    };
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "webhooks" &&
    segments[2] === "health" &&
    only([]) &&
    validText(segments[1])
  )
    return {
      operation: "webhooks_health",
      input: { subscriptionKey: segments[1] },
    };
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "webhooks" &&
    segments[2] === "deliveries" &&
    only(["limit"]) &&
    validText(segments[1])
  )
    return {
      operation: "webhooks_history",
      input: { subscriptionKey: segments[1], ...limit },
    };
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "webhooks" &&
    segments[2] === "rotate" &&
    only([]) &&
    onlyBody(body, []) &&
    validText(segments[1])
  )
    return {
      operation: "webhooks_rotate",
      input: { subscriptionKey: segments[1] },
    };
  if (
    method === "POST" &&
    segments.length === 5 &&
    segments[0] === "webhooks" &&
    segments[2] === "deliveries" &&
    segments[4] === "replay" &&
    only([]) &&
    onlyBody(body, []) &&
    validText(segments[1]) &&
    validText(segments[3])
  )
    return {
      operation: "webhooks_replay",
      input: { subscriptionKey: segments[1], eventKey: segments[3] },
    };
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "webhooks" &&
    segments[2] === "test" &&
    only([]) &&
    onlyBody(body, ["eventType"]) &&
    validText(segments[1]) &&
    validText(body.eventType)
  )
    return {
      operation: "webhooks_test",
      input: { subscriptionKey: segments[1], eventType: body.eventType },
    };
  return null;
}

export async function relayAgentData(
  request: Request,
  operation: AgentDataOperation,
  input: Record<string, unknown>,
  authorization: string,
  idempotencyKey?: string,
) {
  const upstream = agentDataUpstream();
  if (!upstream)
    return agentDataJson(
      request,
      { error: "Agent API is temporarily unavailable." },
      503,
    );
  const suppliedKey =
    idempotencyKey ?? request.headers.get("idempotency-key")?.trim();
  if (operation === "semantic_search" && !suppliedKey)
    return agentDataJson(
      request,
      { error: "idempotency-key is required for semantic search." },
      400,
    );
  const requestedKey = suppliedKey || randomUUID();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(requestedKey))
    return agentDataJson(
      request,
      { error: "idempotency-key must be a bounded identifier." },
      400,
    );
  if (operation === "semantic_search" && requestedKey.length < 8)
    return agentDataJson(
      request,
      { error: "idempotency-key must be 8-96 safe identifier characters." },
      400,
    );
  if (operation === "semantic_search" && requestedKey.length > 96)
    return agentDataJson(
      request,
      { error: "idempotency-key must be 8-96 safe identifier characters." },
      400,
    );
  const workosCredentialStatus =
    await validateWorkOSAgentRegistrationCredential(
      authorization,
      process.env,
    );
  if (workosCredentialStatus === "invalid") {
    const response = agentDataJson(
      request,
      { error: "The WorkOS agent credential is invalid or revoked." },
      401,
    );
    response.headers.set(
      "WWW-Authenticate",
      agentBearerChallenge(401, { invalidToken: true }),
    );
    return response;
  }
  if (workosCredentialStatus === "unavailable")
    return agentDataJson(
      request,
      { error: "WorkOS agent credential validation is temporarily unavailable." },
      503,
    );
  const encoded = JSON.stringify({
    operation,
    input,
    idempotencyKey: requestedKey,
    requestFingerprint: createHash("sha256")
      .update(`${operation}:${canonicalJson(input)}`)
      .digest("hex"),
  });
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    operation === "semantic_search" ? 14_000 : 10_000,
  );
  try {
    const relaySecret =
      operation === "semantic_search"
        ? process.env.AGENT_SEMANTIC_RELAY_SECRET?.trim()
        : undefined;
    if (
      operation === "semantic_search" &&
      (!relaySecret || relaySecret.length < 32)
    )
      return agentDataJson(
        request,
        { error: "Agent semantic search is temporarily unavailable." },
        503,
      );
    const response = await fetch(upstream, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        accept: "application/json",
        ...(relaySecret ? { "x-symbaiex-semantic-relay": relaySecret } : {}),
        ...(request.headers.get("origin")
          ? { origin: request.headers.get("origin")! }
          : {}),
      },
      body: encoded,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const declaredLength = Number(
      response.headers.get("content-length") ?? "0",
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > AGENT_DATA_MAX_RESPONSE_BYTES
    ) {
      response.body?.cancel();
      return agentDataJson(
        request,
        { error: "Agent API returned an invalid response." },
        502,
      );
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > AGENT_DATA_MAX_RESPONSE_BYTES)
      return agentDataJson(
        request,
        { error: "Agent API returned an invalid response." },
        502,
      );
    const headers = agentDataHeaders(
      request,
      response.headers.get("content-type") ?? "application/json",
    );
    const payload = parseJsonObject(bytes);
    const retryAfterSeconds = retryAfterFrom(payload, response.status);
    if (retryAfterSeconds !== null) {
      headers.set("Retry-After", String(retryAfterSeconds));
      headers.set("RateLimit", `"agent-minute";r=0;t=${retryAfterSeconds}`);
    }
    const asyncLocation = asyncJobLocation(operation, payload);
    if (asyncLocation !== null) headers.set("Location", asyncLocation);
    return new Response(bytes, {
      status:
        response.status === 200 && asyncLocation !== null
          ? 202
          : response.status,
      headers,
    });
  } catch {
    return agentDataJson(
      request,
      { error: "Agent API is temporarily unavailable." },
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Streams a stored artifact through the first-party API. The upstream Convex
 * action rechecks the bearer-derived agent, owner, entitlement, job state, and
 * expiry immediately before reading storage; callers never receive a storage
 * URL that could outlive those checks.
 */
export async function relayAgentArtifact(
  request: Request,
  kind: AgentArtifactKind,
  jobId: string,
  authorization: string,
  datasetId?: string,
) {
  const upstream = agentArtifactUpstream();
  if (!upstream)
    return agentDataJson(
      request,
      { error: "Agent API is temporarily unavailable." },
      503,
    );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(upstream, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        accept: "application/octet-stream, application/json",
        ...(request.headers.get("origin")
          ? { origin: request.headers.get("origin")! }
          : {}),
      },
      body: JSON.stringify(
        kind === "dataset-version" || kind === "dataset-version-manifest"
          ? { kind, datasetId, versionId: jobId }
          : { kind, jobId },
      ),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const headers = agentDataHeaders(
      request,
      response.headers.get("content-type") ?? "application/json",
    );
    for (const name of [
      "content-length",
      "content-disposition",
      "etag",
      "x-artifact-sha256",
    ]) {
      const value = response.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return agentDataJson(
      request,
      { error: "Agent API is temporarily unavailable." },
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseLimit(value: string | null) {
  if (value === null) return {};
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 50)
    return { invalid: true } as Record<string, unknown>;
  return { limit: Number(value) };
}
function validText(value: unknown) {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 300
  );
}
function onlyBody(body: Record<string, unknown>, allowed: string[]) {
  return Object.keys(body).every((key) => allowed.includes(key));
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function parseJsonObject(bytes: ArrayBuffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function retryAfterFrom(
  payload: Record<string, unknown> | null,
  status: number,
) {
  if (status !== 429) return null;
  const milliseconds = payload?.retryAfter;
  return typeof milliseconds === "number" && Number.isFinite(milliseconds)
    ? Math.max(1, Math.ceil(milliseconds / 1_000))
    : 60;
}

function asyncJobLocation(
  operation: AgentDataOperation,
  payload: Record<string, unknown> | null,
) {
  if (
    (operation !== "research_create" && operation !== "export_create") ||
    typeof payload?.jobId !== "string" ||
    !["queued", "running"].includes(String(payload.status))
  ) {
    return null;
  }
  const collection =
    operation === "research_create" ? "research-jobs" : "exports";
  return `https://www.symbaiex.com/api/agent/v1/${collection}/${encodeURIComponent(payload.jobId)}`;
}
function agentDataUpstream() {
  const configured =
    process.env.CONVEX_SITE_URL?.trim() ??
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      return null;
    url.pathname = "/agent/v1";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

function agentArtifactUpstream() {
  const upstream = agentDataUpstream();
  if (!upstream) return null;
  const url = new URL(upstream);
  url.pathname = "/agent/artifact";
  return url.toString();
}
