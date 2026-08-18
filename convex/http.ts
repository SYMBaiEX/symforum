import { httpRouter, makeFunctionReference } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import { env, httpAction } from "./_generated/server";
import { resend } from "./resendClient";
import { AGENT_MCP_RESOURCE_AUDIENCE } from "./agentIdentityCrypto";
import { normalizeAgentDataHttpError } from "./agentDataHttpErrors";

const http = httpRouter();
const FORUM_ATTACHMENT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const FORUM_ATTACHMENT_ALLOWED_CONTENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/zip",
]);
const FORUM_ATTACHMENT_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://forum.localhost:3000",
  "http://symbaiex.localhost:3000",
  "https://symbaiex.com",
  "https://www.symbaiex.com",
  "https://forum.symbaiex.com",
]);
const AGENT_AUTH_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://forum.localhost:3000",
  "http://symbaiex.localhost:3000",
  "https://symbaiex.com",
  "https://www.symbaiex.com",
  "https://forum.symbaiex.com",
]);
const AGENT_AUTH_MAX_BODY_BYTES = 16 * 1024;
const AGENT_DATA_MAX_BODY_BYTES = 32 * 1024;
const AGENT_SEMANTIC_RELAY_HEADER = "x-symbaiex-semantic-relay";

const agentSemanticDispatchRef = makeFunctionReference<
  "action",
  {
    query: string;
    limit: number;
    idempotencyKey: string;
    requestFingerprint: string;
  },
  unknown
>("agentSemanticApi:dispatch");

auth.addHttpRoutes(http);

for (const path of [
  "/agent/auth/challenge",
  "/agent/auth/sign-in",
  "/agent/auth/refresh",
] as const) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(
      async (_ctx, request) =>
        new Response(null, {
          status: 204,
          headers: agentAuthCorsHeaders(request),
        }),
    ),
  });
}

http.route({
  path: "/agent/quota",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, {
      status: 204,
      headers: agentQuotaCorsHeaders(request),
    });
  }),
});

http.route({
  path: "/agent/v1",
  method: "OPTIONS",
  handler: httpAction(
    async (_ctx, request) =>
      new Response(null, {
        status: 204,
        headers: agentDataCorsHeaders(request),
      }),
  ),
});

/**
 * Internal-to-the-first-party relay for artifact bytes. Storage URLs are never
 * returned to agents: this route revalidates the bearer-derived identity and
 * artifact entitlement immediately before streaming the blob.
 */
http.route({
  path: "/agent/artifact",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const headers = agentDataCorsHeaders(request);
    if (!isAllowedAgentAuthOrigin(request))
      return agentDataJson(
        { code: "ORIGIN_DENIED", error: "Origin is not allowed." },
        403,
        headers,
      );
    let agentUserId;
    try {
      agentUserId = await getAuthUserId(ctx);
    } catch {
      agentUserId = null;
    }
    if (agentUserId === null) {
      setAgentDataAuthChallenge(
        headers,
        401,
        request.headers.has("authorization"),
      );
      return agentDataJson(
        {
          code: request.headers.has("authorization")
            ? "INVALID_TOKEN"
            : "AUTH_REQUIRED",
          error: "A bearer access token is required.",
        },
        401,
        headers,
      );
    }
    try {
      const body = await readAgentDataBody(request);
      if (
        !isRecord(body) ||
        (body.kind !== "research" && body.kind !== "export") ||
        typeof body.jobId !== "string" ||
        body.jobId.length === 0 ||
        body.jobId.length > 160
      )
        return agentDataJson(
          { code: "INVALID_REQUEST", error: "kind and jobId are required." },
          400,
          headers,
        );
      const artifact = await ctx.runQuery(
        internal.evidenceJobs.resolveArtifactDownload,
        body.kind === "research"
          ? {
              agentUserId,
              kind: "research",
              researchJobId: body.jobId as Id<"evidenceResearchJobs">,
            }
          : {
              agentUserId,
              kind: "export",
              exportJobId: body.jobId as Id<"evidenceExportJobs">,
            },
      );
      if (artifact === null)
        return agentDataJson(
          { code: "ARTIFACT_UNAVAILABLE", error: "Artifact is unavailable." },
          404,
          headers,
        );
      const blob = await ctx.storage.get(artifact.storageId);
      if (blob === null)
        return agentDataJson(
          { code: "ARTIFACT_UNAVAILABLE", error: "Artifact is unavailable." },
          404,
          headers,
        );
      if (
        blob.size !== artifact.byteLength ||
        blob.type !== artifact.contentType
      )
        return agentDataJson(
          {
            code: "ARTIFACT_METADATA_MISMATCH",
            error: "Artifact metadata no longer matches stored content.",
          },
          409,
          headers,
        );
      const responseHeaders = new Headers(headers);
      responseHeaders.set("Content-Type", blob.type);
      responseHeaders.set("Content-Length", String(blob.size));
      responseHeaders.set(
        "Content-Disposition",
        `attachment; filename="${artifact.filename}"`,
      );
      responseHeaders.set("ETag", `\"${artifact.sha256}\"`);
      responseHeaders.set("X-Artifact-SHA256", artifact.sha256);
      return new Response(blob.stream(), {
        status: 200,
        headers: responseHeaders,
      });
    } catch (error) {
      const { payload, status } = normalizeAgentDataHttpError(error);
      if (status === 403) setAgentDataAuthChallenge(headers, 403);
      return agentDataJson(payload, status, headers);
    }
  }),
});

http.route({
  path: "/agent/v1",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const headers = agentDataCorsHeaders(request);
    if (!isAllowedAgentAuthOrigin(request))
      return agentDataJson(
        { code: "ORIGIN_DENIED", error: "Origin is not allowed." },
        403,
        headers,
      );
    let userIdentity;
    try {
      userIdentity = await ctx.auth.getUserIdentity();
    } catch {
      setAgentDataAuthChallenge(headers, 401, true);
      return agentDataJson(
        {
          code: "INVALID_TOKEN",
          error: "A bearer access token is required.",
        },
        401,
        headers,
      );
    }
    if (userIdentity === null) {
      const invalidToken = request.headers.has("authorization");
      setAgentDataAuthChallenge(headers, 401, invalidToken);
      return agentDataJson(
        {
          code: invalidToken ? "INVALID_TOKEN" : "AUTH_REQUIRED",
          error: "A bearer access token is required.",
        },
        401,
        headers,
      );
    }
    try {
      const body = await readAgentDataBody(request);
      if (
        !isRecord(body) ||
        typeof body.operation !== "string" ||
        !isAgentDataOperation(body.operation) ||
        !isRecord(body.input) ||
        typeof body.idempotencyKey !== "string" ||
        typeof body.requestFingerprint !== "string"
      ) {
        return agentDataJson(
          {
            code: "INVALID_REQUEST",
            error:
              "operation, input, idempotencyKey, and requestFingerprint are required.",
          },
          400,
          headers,
        );
      }
      let result: unknown;
      if (body.operation === "semantic_search") {
        if (!isTrustedSemanticRelay(request)) {
          return agentDataJson(
            { code: "NOT_FOUND", error: "Agent data endpoint was not found." },
            404,
            headers,
          );
        }
        const query = body.input.query;
        const limit = body.input.limit ?? 10;
        if (
          typeof query !== "string" ||
          typeof limit !== "number" ||
          typeof body.idempotencyKey !== "string" ||
          typeof body.requestFingerprint !== "string"
        ) {
          return agentDataJson(
            {
              code: "INVALID_REQUEST",
              error: "Invalid semantic search request.",
            },
            400,
            headers,
          );
        }
        result = await ctx.runAction(agentSemanticDispatchRef, {
          query,
          limit,
          idempotencyKey: body.idempotencyKey,
          requestFingerprint: body.requestFingerprint,
        });
      } else {
        result = await ctx.runMutation(
          (internal as unknown as { agentDataApi: { dispatch: never } })
            .agentDataApi.dispatch,
          {
            operation: body.operation,
            input: body.input,
            idempotencyKey: body.idempotencyKey,
            requestFingerprint: body.requestFingerprint,
          } as never,
        );
      }
      return agentDataJson(result, 200, headers);
    } catch (error) {
      const { payload, status } = normalizeAgentDataHttpError(error);
      if (status === 403) setAgentDataAuthChallenge(headers, 403);
      return agentDataJson(payload, status, headers);
    }
  }),
});

http.route({
  path: "/agent/quota",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const corsHeaders = agentQuotaCorsHeaders(request);
    if (!isAllowedAgentAuthOrigin(request)) {
      return agentQuotaJson(
        { error: "Origin is not allowed." },
        403,
        corsHeaders,
      );
    }
    if ((await ctx.auth.getUserIdentity()) === null) {
      return agentQuotaJson(
        { error: "Agent authentication is required." },
        401,
        corsHeaders,
      );
    }
    try {
      const quota = await ctx.runQuery(api.agentQuota.getMyAgentQuota, {});
      return agentQuotaJson(quota, 200, corsHeaders);
    } catch {
      return agentQuotaJson(
        { error: "An active agent identity is required." },
        403,
        corsHeaders,
      );
    }
  }),
});

http.route({
  path: "/agent/auth/challenge",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const corsHeaders = agentAuthCorsHeaders(request);
    if (!isAllowedAgentAuthOrigin(request)) {
      return agentAuthJson(
        { error: "Origin is not allowed." },
        403,
        corsHeaders,
      );
    }
    try {
      const body = await readAgentAuthBody(request);
      if (!isRecord(body) || typeof body.agentId !== "string") {
        return agentAuthJson(
          { error: "agentId is required." },
          400,
          corsHeaders,
        );
      }
      const result = await ctx.runMutation(
        api.agentIdentity.requestLoginChallenge,
        {
          agentId: body.agentId,
          audience: agentAuthAudience(),
        },
      );
      return agentAuthJson(result, 200, corsHeaders);
    } catch (error) {
      return agentAuthJson(agentAuthError(error), 400, corsHeaders);
    }
  }),
});

http.route({
  path: "/agent/auth/sign-in",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const corsHeaders = agentAuthCorsHeaders(request);
    if (!isAllowedAgentAuthOrigin(request)) {
      return agentAuthJson(
        { error: "Origin is not allowed." },
        403,
        corsHeaders,
      );
    }
    try {
      const body = await readAgentAuthBody(request);
      if (
        !isRecord(body) ||
        typeof body.agentId !== "string" ||
        typeof body.challenge !== "string" ||
        typeof body.signature !== "string"
      ) {
        return agentAuthJson(
          { error: "agentId, challenge, and signature are required." },
          400,
          corsHeaders,
        );
      }
      const result = await ctx.runAction(api.auth.signIn, {
        provider: "agent-key",
        params: {
          agentId: body.agentId,
          challenge: body.challenge,
          audience: agentAuthAudience(),
          signature: body.signature,
        },
        calledBy: "agent-http",
      });
      if (result.tokens === null || result.tokens === undefined) {
        return agentAuthJson(
          { error: "Agent authentication failed." },
          401,
          corsHeaders,
        );
      }
      return agentAuthJson({ tokens: result.tokens }, 200, corsHeaders);
    } catch (error) {
      return agentAuthJson(
        { error: "Agent authentication failed." },
        401,
        corsHeaders,
      );
    }
  }),
});

http.route({
  path: "/agent/auth/refresh",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const corsHeaders = agentAuthCorsHeaders(request);
    if (!isAllowedAgentAuthOrigin(request)) {
      return agentAuthJson(
        { error: "Origin is not allowed." },
        403,
        corsHeaders,
      );
    }
    try {
      const body = await readAgentAuthBody(request);
      if (!isRecord(body) || typeof body.refreshToken !== "string") {
        return agentAuthJson(
          { error: "refreshToken is required." },
          400,
          corsHeaders,
        );
      }
      const result = await ctx.runAction(api.auth.signIn, {
        refreshToken: body.refreshToken,
        calledBy: "agent-http-refresh",
      });
      if (result.tokens === null || result.tokens === undefined) {
        return agentAuthJson(
          { error: "Agent session refresh failed." },
          401,
          corsHeaders,
        );
      }
      return agentAuthJson({ tokens: result.tokens }, 200, corsHeaders);
    } catch (error) {
      return agentAuthJson(
        { error: "Agent session refresh failed." },
        401,
        corsHeaders,
      );
    }
  }),
});

http.route({
  path: "/forum-attachment-upload",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, {
      status: 204,
      headers: forumAttachmentUploadCorsHeaders(request),
    });
  }),
});

http.route({
  path: "/forum-attachment-upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const corsHeaders = forumAttachmentUploadCorsHeaders(request);

    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity === null) {
        return forumAttachmentUploadJson(
          { error: "Sign in to upload forum attachments." },
          401,
          corsHeaders,
        );
      }

      const contentType = request.headers.get("content-type") ?? "";
      if (!FORUM_ATTACHMENT_ALLOWED_CONTENT_TYPES.has(contentType)) {
        return forumAttachmentUploadJson(
          { error: "That attachment type is not allowed." },
          415,
          corsHeaders,
        );
      }

      const encodedFilename =
        request.headers.get("x-forum-attachment-filename") ?? "";
      const filename = safeDecodeForumAttachmentFilename(encodedFilename);
      if (filename.trim().length === 0) {
        return forumAttachmentUploadJson(
          { error: "Attachment filename is required." },
          400,
          corsHeaders,
        );
      }

      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0) {
        return forumAttachmentUploadJson(
          { error: "Attachment file is empty." },
          400,
          corsHeaders,
        );
      }
      if (bytes.byteLength > FORUM_ATTACHMENT_MAX_FILE_BYTES) {
        return forumAttachmentUploadJson(
          { error: "Attachments must be 5 MB or smaller." },
          413,
          corsHeaders,
        );
      }

      await ctx.runQuery(internal.forum.authorizeForumAttachmentUpload, {});
      const storageId = await ctx.storage.store(
        new Blob([bytes], { type: contentType }),
      );
      const attachment = await ctx.runMutation(
        internal.forum.claimStoredForumAttachmentUpload,
        {
          storageId,
          filename,
          contentType,
        },
      );

      return forumAttachmentUploadJson(attachment, 200, corsHeaders);
    } catch (error) {
      return forumAttachmentUploadJson(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not upload forum attachment.",
        },
        400,
        corsHeaders,
      );
    }
  }),
});

http.route({
  path: "/resend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    return await resend.handleResendEventWebhook(ctx, request);
  }),
});

export default http;

function forumAttachmentUploadCorsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, content-type, x-forum-attachment-filename",
    "Access-Control-Max-Age": "86400",
  });
  if (origin !== null && isAllowedForumAttachmentOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function agentAuthAudience() {
  const configured = env.SITE_URL?.trim();
  if (configured) {
    try {
      const origin = new URL(configured).origin;
      if (
        AGENT_AUTH_ALLOWED_ORIGINS.has(origin) &&
        ["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
      ) {
        return `${origin}/api/agent/mcp`;
      }
    } catch {
      // Fall through to the canonical public platform origin.
    }
  }
  return AGENT_MCP_RESOURCE_AUDIENCE;
}

function agentAuthCorsHeaders(request: Request) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin !== null && isAllowedAgentAuthOrigin(request)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function agentQuotaCorsHeaders(request: Request) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin !== null && isAllowedAgentAuthOrigin(request)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function agentDataCorsHeaders(request: Request) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Expose-Headers": "www-authenticate",
    Vary: "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin !== null && isAllowedAgentAuthOrigin(request))
    headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function setAgentDataAuthChallenge(
  headers: Headers,
  status: 401 | 403,
  invalidToken = false,
) {
  const resourceMetadata = new URL(
    "/.well-known/oauth-protected-resource",
    agentAuthAudience(),
  ).toString();
  headers.set(
    "WWW-Authenticate",
    [
      "Bearer",
      status === 403 ? 'error="insufficient_scope",' : "",
      status === 401 && invalidToken ? 'error="invalid_token",' : "",
      'scope="evidence",',
      `resource_metadata="${resourceMetadata}"`,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function isAllowedAgentAuthOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return AGENT_AUTH_ALLOWED_ORIGINS.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

async function readAgentAuthBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > AGENT_AUTH_MAX_BODY_BYTES
  ) {
    throw new Error("Request body is too large.");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > AGENT_AUTH_MAX_BODY_BYTES) {
    throw new Error("Request body is too large.");
  }
  const text = new TextDecoder().decode(bytes);
  if (text.trim().length === 0) throw new Error("Request body is required.");
  return JSON.parse(text) as unknown;
}

async function readAgentDataBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > AGENT_DATA_MAX_BODY_BYTES
  )
    throw new Error("Request body is too large.");
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new Error("Content-Type must be application/json.");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error("Request body is required.");
  if (bytes.byteLength > AGENT_DATA_MAX_BODY_BYTES)
    throw new Error("Request body is too large.");
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function isAgentDataOperation(
  value: string,
): value is
  | "status"
  | "sources"
  | "search"
  | "semantic_search"
  | "universal_search"
  | "document"
  | "changes"
  | "verify"
  | "entities"
  | "version_claims"
  | "claim_timeline"
  | "products"
  | "datasets"
  | "benchmarks"
  | "quota"
  | "entitlements"
  | "usage"
  | "research_create"
  | "research_get"
  | "research_artifact"
  | "export_create"
  | "export_get"
  | "export_artifact"
  | "webhooks_list"
  | "webhooks_availability"
  | "webhooks_create"
  | "webhooks_status"
  | "webhooks_health"
  | "webhooks_history"
  | "webhooks_rotate"
  | "webhooks_replay"
  | "webhooks_test" {
  return [
    "status",
    "sources",
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
    "webhooks_list",
    "webhooks_availability",
    "webhooks_create",
    "webhooks_status",
    "webhooks_health",
    "webhooks_history",
    "webhooks_rotate",
    "webhooks_replay",
    "webhooks_test",
  ].includes(value);
}

function isTrustedSemanticRelay(request: Request) {
  // Generated bindings update during the authorized deployment/codegen step.
  const configured = (
    env as unknown as { AGENT_SEMANTIC_RELAY_SECRET?: string }
  ).AGENT_SEMANTIC_RELAY_SECRET?.trim();
  const supplied = request.headers.get(AGENT_SEMANTIC_RELAY_HEADER)?.trim();
  if (
    configured === undefined ||
    configured.length < 32 ||
    supplied === undefined ||
    supplied.length !== configured.length
  ) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < configured.length; index += 1) {
    mismatch |= configured.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return mismatch === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function agentAuthError(error: unknown) {
  if (error instanceof Error && error.message.length <= 180) {
    return { error: error.message };
  }
  return { error: "Agent challenge could not be issued." };
}

function agentAuthJson(payload: unknown, status: number, headers: Headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
}

function agentQuotaJson(payload: unknown, status: number, headers: Headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
}

function agentDataJson(payload: unknown, status: number, headers: Headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
}

function isAllowedForumAttachmentOrigin(origin: string) {
  try {
    return FORUM_ATTACHMENT_ALLOWED_ORIGINS.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function forumAttachmentUploadJson(
  payload: unknown,
  status: number,
  headers: Headers,
) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
}

function safeDecodeForumAttachmentFilename(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
