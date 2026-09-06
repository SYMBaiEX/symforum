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
export const GET = handler;
export const POST = handler;
export function OPTIONS(request: Request) {
  return isAllowedAgentOrigin(request)
    ? new Response(null, { status: 204, headers: agentDataHeaders(request) })
    : agentDataJson(request, { error: "Origin is not allowed." }, 403);
}
