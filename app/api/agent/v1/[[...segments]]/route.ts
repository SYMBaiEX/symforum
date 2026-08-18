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

export const dynamic = "force-dynamic";

async function handler(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
) {
  if (!isAllowedAgentOrigin(request))
    return agentDataJson(request, { error: "Origin is not allowed." }, 403);
  const authorization = bearer(request);
  if (!authorization)
    return agentDataJson(
      request,
      { error: "A bearer access token is required." },
      401,
    );
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
    mapped.operation === "export_artifact"
  ) {
    const jobId = mapped.input.jobId;
    if (typeof jobId !== "string")
      return agentDataJson(
        request,
        { error: "Unknown or invalid agent data endpoint." },
        404,
      );
    return relayAgentArtifact(
      request,
      mapped.operation === "research_artifact" ? "research" : "export",
      jobId,
      authorization,
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
