import {
  AGENT_DATA_MAX_BODY_BYTES,
  agentDataHeaders,
  agentDataJson,
  bearer,
  isAllowedAgentOrigin,
  mapRestRequest,
  relayAgentArtifact,
  relayAgentData,
} from "@/lib/agent-data-api-relay";
import { agentBearerChallenge } from "@/lib/agent-auth-metadata";

export const dynamic = "force-dynamic";

const MAX_BATCH_OPERATIONS = 10;
const BATCH_READ_OPERATIONS = new Set([
  "status",
  "sources",
  "source_registry",
  "search",
  "semantic_search",
  "universal_search",
  "document",
  "changes",
  "entities",
  "version_claims",
  "claim_timeline",
  "products",
  "datasets",
  "dataset_versions",
  "dataset_version_diff",
  "benchmarks",
  "quota",
  "entitlements",
  "usage",
  "research_get",
  "export_get",
  "webhooks_list",
  "webhooks_availability",
  "webhooks_health",
  "webhooks_history",
]);

async function handler(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
) {
  if (!isAllowedAgentOrigin(request))
    return agentDataJson(request, { error: "Origin is not allowed." }, 403);
  const authorization = bearer(request);
  if (!authorization) {
    const response = agentDataJson(
      request,
      {
        error: "A bearer access token is required.",
        code: "AGENT_AUTH_REQUIRED",
        resolution:
          "Read /auth.md and enroll an owner-approved Ed25519 identity.",
      },
      401,
    );
    response.headers.set("WWW-Authenticate", agentBearerChallenge(401));
    return response;
  }
  let body: Record<string, unknown> = {};
  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(contentLength) &&
      contentLength > AGENT_DATA_MAX_BODY_BYTES
    )
      return agentDataJson(
        request,
        { error: "Request body is too large." },
        413,
      );
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > AGENT_DATA_MAX_BODY_BYTES)
      return agentDataJson(
        request,
        { error: "Request body is too large." },
        413,
      );
    if (bytes.byteLength > 0) {
      if (
        !/^application\/json(?:;|$)/i.test(
          request.headers.get("content-type") ?? "",
        )
      )
        return agentDataJson(
          request,
          { error: "Content-Type must be application/json." },
          415,
        );
      try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error();
        body = parsed as Record<string, unknown>;
      } catch {
        return agentDataJson(
          request,
          { error: "Request body must be a JSON object." },
          400,
        );
      }
    }
  }
  const { segments = [] } = await context.params;
  if (
    request.method === "POST" &&
    segments.length === 1 &&
    segments[0] === "batch"
  ) {
    return handleBatch(request, body, authorization);
  }
  const mapped = mapRestRequest(
    request.method,
    segments,
    new URL(request.url).searchParams,
    body,
  );
  if (!mapped || "invalid" in mapped.input)
    return agentDataJson(
      request,
      { error: "Unknown or invalid agent data endpoint." },
      404,
    );
  if (
    mapped.operation === "research_artifact" ||
    mapped.operation === "export_artifact" ||
    mapped.operation === "export_manifest" ||
    mapped.operation === "dataset_version_artifact" ||
    mapped.operation === "dataset_version_manifest"
  ) {
    const jobId =
      mapped.operation === "dataset_version_artifact" ||
      mapped.operation === "dataset_version_manifest"
        ? mapped.input.versionId
        : mapped.input.jobId;
    if (typeof jobId !== "string")
      return agentDataJson(
        request,
        { error: "Unknown or invalid agent data endpoint." },
        404,
      );
    return relayAgentArtifact(
      request,
      mapped.operation === "research_artifact"
        ? "research"
        : mapped.operation === "export_manifest"
          ? "export-manifest"
          : mapped.operation === "dataset_version_artifact"
            ? "dataset-version"
            : mapped.operation === "dataset_version_manifest"
              ? "dataset-version-manifest"
              : "export",
      jobId,
      authorization,
      typeof mapped.input.datasetId === "string"
        ? mapped.input.datasetId
        : undefined,
    );
  }
  return relayAgentData(request, mapped.operation, mapped.input, authorization);
}

async function handleBatch(
  request: Request,
  body: Record<string, unknown>,
  authorization: string,
) {
  if (
    Object.keys(body).some((key) => key !== "operations") ||
    !Array.isArray(body.operations) ||
    body.operations.length < 1 ||
    body.operations.length > MAX_BATCH_OPERATIONS
  ) {
    return agentDataJson(
      request,
      {
        error: `Batch requests require 1-${MAX_BATCH_OPERATIONS} operations.`,
        code: "AGENT_BATCH_INVALID",
      },
      400,
    );
  }

  const mapped = body.operations.map((candidate, index) => {
    try {
      if (!isRecord(candidate)) return null;
      const keys = Object.keys(candidate);
      if (
        keys.some((key) => !["id", "method", "path"].includes(key)) ||
        typeof candidate.id !== "string" ||
        candidate.id.length < 1 ||
        candidate.id.length > 80 ||
        (candidate.method !== undefined && candidate.method !== "GET") ||
        typeof candidate.path !== "string" ||
        !candidate.path.startsWith("/v1/") ||
        candidate.path.includes("#")
      ) {
        return null;
      }
      const url = new URL(`/api/agent${candidate.path}`, request.url);
      if (url.origin !== new URL(request.url).origin) return null;
      const segments = url.pathname
        .slice("/api/agent/v1/".length)
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      const operation = mapRestRequest("GET", segments, url.searchParams);
      if (!operation || !BATCH_READ_OPERATIONS.has(operation.operation)) {
        return null;
      }
      return { id: candidate.id, ...operation, index };
    } catch {
      return null;
    }
  });

  if (mapped.some((entry) => entry === null)) {
    return agentDataJson(
      request,
      {
        error:
          "Each batch item must be a unique-id GET request to a documented non-artifact /v1 read endpoint.",
        code: "AGENT_BATCH_OPERATION_INVALID",
      },
      400,
    );
  }
  const ids = mapped.map((entry) => entry!.id);
  if (new Set(ids).size !== ids.length) {
    return agentDataJson(
      request,
      {
        error: "Batch operation ids must be unique.",
        code: "AGENT_BATCH_ID_DUPLICATE",
      },
      400,
    );
  }

  const results = await Promise.all(
    mapped.map(async (entry) => {
      const response = await relayAgentData(
        request,
        entry!.operation,
        entry!.input,
        authorization,
        `batch:${entry!.index}:${crypto.randomUUID()}`,
      );
      const responseBody = await response.json().catch(() => ({
        error: "Agent API returned a non-JSON batch response.",
        code: "AGENT_BATCH_RESPONSE_INVALID",
      }));
      return {
        id: entry!.id,
        status: response.status,
        body: responseBody,
      };
    }),
  );
  return agentDataJson(request, { results }, 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const GET = handler;
export const POST = handler;
export function OPTIONS(request: Request) {
  return isAllowedAgentOrigin(request)
    ? new Response(null, { status: 204, headers: agentDataHeaders(request) })
    : agentDataJson(request, { error: "Origin is not allowed." }, 403);
}
