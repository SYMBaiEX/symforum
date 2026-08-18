import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

const API_BASE_URL = primarySiteUrl("/api/agent");
const INSTRUCTIONS_URL = primarySiteUrl("/agent/instructions");

const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "SYMBaiEX Agent API",
    version: "v1",
    description:
      "Public discovery, Ed25519 authentication, quota, provenance reads, cited research jobs, bounded exports, and signed webhooks. Payments are not accepted; GraphQL is deferred.",
    termsOfService: primarySiteUrl("/ai-policy"),
  },
  servers: [{ url: API_BASE_URL }],
  externalDocs: {
    description: "SYMBaiEX machine-facing operating instructions",
    url: INSTRUCTIONS_URL,
  },
  paths: {
    "/": {
      get: {
        operationId: "getAgentApiManifest",
        summary: "Get the current API manifest",
        responses: {
          "200": {
            description:
              "Current capabilities, scopes, quotas, and payment policy.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Manifest" },
              },
            },
          },
        },
      },
    },
    "/auth/challenge": {
      post: {
        operationId: "requestAgentLoginChallenge",
        summary: "Request a one-time Ed25519 login challenge",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChallengeRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Signable challenge message." },
          "400": { description: "Invalid request or inactive agent." },
          "429": { description: "Challenge rate limit reached." },
        },
      },
    },
    "/quota": {
      get: {
        operationId: "getAgentQuota",
        summary: "Read the authenticated agent's current quota",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Current owner and agent quota status." },
          "401": { description: "Missing or invalid access token." },
          "403": { description: "The token is not an active agent identity." },
        },
      },
    },
    "/v1/status": {
      get: {
        operationId: "getEvidenceStatus",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Evidence API availability." } },
      },
    },
    "/v1/sources": {
      get: {
        operationId: "listEvidenceSources",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Public evidence sources." } },
      },
    },
    "/v1/search": {
      get: {
        operationId: "searchEvidence",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Bounded public evidence search." },
        },
      },
    },
    "/v1/universal-search": {
      get: {
        operationId: "searchUniversalPublicCorpus",
        summary: "Search the bounded public lexical corpus",
        description:
          "Federates public evidence documents, claims, entities, published blog posts, sent newsletters, indexed news, and currently public forum threads. Semantic/vector search is deferred; each result is rechecked for current public visibility. Recency is captured once per request, making a response's ordering deterministic while later requests may legitimately receive fresher scores.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 300 },
          },
          { $ref: "#/components/parameters/Limit" },
        ],
        responses: {
          "200": {
            description:
              "Deterministically ordered public lexical results with canonical URLs, timestamps, provenance, and score explanations.",
          },
          "403": { description: "The evidence scope is required." },
          "429": { description: "Quota or rate limit reached." },
        },
      },
    },
    "/v1/documents/{documentId}": {
      get: {
        operationId: "getEvidenceDocument",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "documentId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "Public evidence document." } },
      },
    },
    "/v1/changes": {
      get: {
        operationId: "listEvidenceChanges",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Public evidence change feed." } },
      },
    },
    "/v1/claims/{claimId}/verify": {
      post: {
        operationId: "verifyEvidenceClaim",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "claimId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Stored-claim verification result." },
        },
      },
    },
    "/v1/entities": {
      get: {
        operationId: "searchEvidenceEntities",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 200 },
          },
        ],
        responses: {
          "200": { description: "Bounded normalized public entity matches." },
        },
      },
    },
    "/v1/document-versions/{documentVersionId}/claims": {
      get: {
        operationId: "listVersionClaims",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "documentVersionId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description:
              "Claims and immutable citations tied to this exact document version.",
          },
        },
      },
    },
    "/v1/products": {
      get: {
        operationId: "listEvidenceProducts",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Current public evidence products." },
        },
      },
    },
    "/v1/datasets": {
      get: {
        operationId: "listEvidenceDatasets",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Current public evidence datasets." },
        },
      },
    },
    "/v1/benchmarks": {
      get: {
        operationId: "listEvidenceBenchmarks",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Current public benchmarks." } },
      },
    },
    "/v1/entitlements": {
      get: {
        operationId: "getEvidenceEntitlements",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "Effective owner-scoped product access, including free-beta grants.",
          },
        },
      },
    },
    "/v1/usage": {
      get: {
        operationId: "getEvidenceUsage",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/Limit" }],
        responses: {
          "200": {
            description: "Recent immutable owner-scoped usage ledger entries.",
          },
        },
      },
    },
    "/v1/research-jobs": {
      post: {
        operationId: "createEvidenceResearchJob",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ResearchJobRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Queued or replayed source-cited research job.",
          },
          "400": { description: "Invalid or mismatched idempotent request." },
          "429": { description: "Quota or rate limit reached." },
        },
      },
    },
    "/v1/research-jobs/{jobId}": {
      get: {
        operationId: "getEvidenceResearchJob",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Owner-scoped job status and cited result." },
        },
      },
    },
    "/v1/research-jobs/{jobId}/artifact": {
      get: {
        operationId: "getEvidenceResearchArtifact",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description:
              "Authenticated first-party JSON artifact stream. The bearer token is rechecked at download time; no storage URL is issued.",
          },
        },
      },
    },
    "/v1/exports": {
      post: {
        operationId: "createEvidenceExport",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ExportRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Queued or replayed bounded JSONL export." },
          "400": {
            description: "Invalid dataset, format, or idempotent request.",
          },
          "429": { description: "Quota or rate limit reached." },
        },
      },
    },
    "/v1/exports/{jobId}": {
      get: {
        operationId: "getEvidenceExport",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description:
              "Owner-scoped export status, checksum, and record count.",
          },
        },
      },
    },
    "/v1/exports/{jobId}/artifact": {
      get: {
        operationId: "getEvidenceExportArtifact",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description:
              "Authenticated first-party JSONL artifact stream. The bearer token is rechecked at download time; no storage URL is issued.",
          },
        },
      },
    },
    "/v1/webhooks": {
      get: {
        operationId: "listEvidenceWebhooks",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Owner-scoped webhook subscriptions." },
        },
      },
      post: {
        operationId: "createEvidenceWebhook",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WebhookRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Created allowlisted HTTPS webhook subscription.",
          },
          "400": { description: "Invalid or non-allowlisted destination." },
        },
      },
    },
    "/v1/webhooks/{subscriptionKey}/status": {
      post: {
        operationId: "setEvidenceWebhookStatus",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "subscriptionKey",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: {
                  status: { enum: ["active", "paused", "revoked"] },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated owner-scoped subscription state." },
        },
      },
    },
    "/mcp": {
      post: {
        operationId: "evidenceMcp",
        summary: "Call the stateless MCP evidence server",
        description:
          "Protocol 2026-07-28 uses server/discover and per-request metadata. Legacy 2025-03-26 initialize remains available only for legacy callers. Authentication uses the documented custom Ed25519 flow, not OAuth authorization endpoints.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/McpProtocolVersion" },
          { $ref: "#/components/parameters/McpMethod" },
          { $ref: "#/components/parameters/McpName" },
        ],
        responses: {
          "200": {
            description:
              "JSON-RPC server/discover, tools/list, tools/call, or legacy initialize response.",
          },
          "400": { description: "Malformed or unsupported MCP request." },
          "401": { description: "Missing or invalid access token." },
          "403": { description: "The evidence scope is required." },
        },
      },
    },
    "/auth/sign-in": {
      post: {
        operationId: "signInAgent",
        summary: "Exchange a signed challenge for Convex Auth tokens",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SignInRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Access and refresh tokens." },
          "401": { description: "Invalid, expired, or replayed signature." },
        },
      },
    },
    "/auth/refresh": {
      post: {
        operationId: "refreshAgentSession",
        summary: "Rotate a stored refresh token",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefreshRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Rotated access and refresh tokens." },
          "401": { description: "Invalid or revoked refresh token." },
        },
      },
    },
  },
  components: {
    parameters: {
      Limit: {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: {
          type: "string",
          minLength: 1,
          maxLength: 160,
          pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        },
      },
      McpProtocolVersion: {
        name: "MCP-Protocol-Version",
        in: "header",
        required: false,
        description:
          "Required for protocol 2026-07-28 and matched against request _meta; omitted by legacy initialize callers.",
        schema: { enum: ["2026-07-28", "2025-03-26"] },
      },
      McpMethod: {
        name: "Mcp-Method",
        in: "header",
        required: false,
        description: "Required and body-matched for protocol 2026-07-28.",
        schema: { type: "string" },
      },
      McpName: {
        name: "Mcp-Name",
        in: "header",
        required: false,
        description:
          "Required and body-matched for protocol 2026-07-28 tools/call requests.",
        schema: { type: "string" },
      },
    },
    schemas: {
      ChallengeRequest: {
        type: "object",
        required: ["agentId"],
        properties: {
          agentId: { type: "string", minLength: 2, maxLength: 64 },
        },
        additionalProperties: false,
      },
      SignInRequest: {
        type: "object",
        required: ["agentId", "challenge", "signature"],
        properties: {
          agentId: { type: "string", minLength: 2, maxLength: 64 },
          challenge: { type: "string" },
          audience: { type: "string" },
          signature: { type: "string" },
        },
        additionalProperties: false,
      },
      RefreshRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: { refreshToken: { type: "string" } },
        additionalProperties: false,
      },
      ResearchJobRequest: {
        type: "object",
        required: ["query"],
        properties: { query: { type: "string", minLength: 1, maxLength: 300 } },
        additionalProperties: false,
      },
      ExportRequest: {
        type: "object",
        required: ["datasetId"],
        properties: {
          datasetId: { type: "string" },
          format: { const: "jsonl", default: "jsonl" },
        },
        additionalProperties: false,
      },
      WebhookRequest: {
        type: "object",
        required: ["subscriptionKey", "url", "eventTypes"],
        properties: {
          subscriptionKey: { type: "string", minLength: 1, maxLength: 96 },
          url: { type: "string", format: "uri", maxLength: 2000 },
          eventTypes: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            uniqueItems: true,
            items: {
              enum: [
                "evidence.document.changed",
                "evidence.research.completed",
                "evidence.export.completed",
                "evidence.benchmark.completed",
                "evidence.claim.verified",
              ],
            },
          },
        },
        additionalProperties: false,
      },
      Manifest: {
        type: "object",
        required: [
          "name",
          "version",
          "baseUrl",
          "authentication",
          "quota",
          "monetization",
        ],
        properties: {
          name: { type: "string" },
          version: { type: "string" },
          baseUrl: { type: "string", format: "uri" },
          authentication: { type: "object" },
          quota: { type: "object" },
          monetization: { type: "object" },
          graphql: { type: "object" },
        },
      },
    },
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
  },
} as const;

export function GET() {
  return new Response(`${JSON.stringify(OPENAPI, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/vnd.oai.openapi+json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}

export function HEAD() {
  return new Response(null, {
    headers: {
      "Content-Type": "application/vnd.oai.openapi+json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
