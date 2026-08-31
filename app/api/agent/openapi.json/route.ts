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
      "Public discovery, Ed25519 authentication, quota, provenance reads, cited research jobs, bounded exports, and signed webhooks. Payments are not accepted; GraphQL is deferred. A future dedicated premium host is not provisioned or advertised by this contract.",
    termsOfService: primarySiteUrl("/terms"),
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
    "/v1/source-registry": {
      get: {
        operationId: "getPublicEvidenceSourceRegistry",
        summary: "Read the normalized scheduled evidence adapter registry",
        description:
          "Returns deterministic public adapter metadata only: official URLs, access and license classes, bounded request model, cadence, and synthetic fixture provenance. It omits credentials, conditional-validator values, cursors, timestamps, and live ingestion status.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Public normalized source registry." },
          "403": { description: "The evidence scope is required." },
        },
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
          "Federates public evidence documents, claims, entities, published blog posts, sent newsletters, indexed news, and currently public forum threads. This endpoint remains lexical-only; feature-gated semantic enhancement has a separate authenticated endpoint. Each result is rechecked for current public visibility. Recency is captured once per request, making a response's ordering deterministic while later requests may legitimately receive fresher scores.",
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
    "/v1/semantic-search": {
      get: {
        operationId: "searchSemanticPublicCorpus",
        summary: "Search with feature-gated semantic enhancement",
        description:
          "Uses the same currently-public corpus and lexical ranking contract as universal search. When semantic retrieval is disabled, unavailable, over budget, paused, or fails validation, the response is lexical-only and carries no monetary commerce or organization charge. Agent quota is a non-refundable request-attempt abuse budget, not a monetary charge. The Ed25519 principal, owner, optional organization service account, project scopes, quota, immutable usage ledger, and spend budget are rechecked before provider-capable work. The request is replay-safe when the same Idempotency-Key and query are reused.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 300 },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 20, default: 10 },
          },
          { $ref: "#/components/parameters/SemanticIdempotencyKey" },
        ],
        responses: {
          "200": {
            description:
              "Currently authorized hybrid results, or lexical-only results when semantic enhancement is unavailable.",
          },
          "400": { description: "Invalid query, limit, or idempotency key." },
          "401": { description: "Missing or invalid Ed25519 session token." },
          "403": {
            description:
              "Evidence scope, active identity, or service-account authorization denied.",
          },
          "409": {
            description: "The idempotent request is still in progress.",
          },
          "429": { description: "Agent or organization budget reached." },
          "503": {
            description:
              "The first-party semantic relay has not been configured.",
          },
        },
      },
    },
    "/v1/documents/{documentId}": {
      get: {
        operationId: "getEvidenceDocument",
        summary: "Read a versioned public evidence document",
        description:
          "Returns document identity, licensing, authorship and dates plus public source provenance, current version hash and retrieval metadata, and bounded citation-relation counts. It excludes raw source payloads and private sources.",
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
    "/v1/claims/{claimKey}/timeline": {
      get: {
        operationId: "listEvidenceClaimTimeline",
        summary: "Read a claim's public supersession timeline",
        description:
          "Returns a bounded, newest-first history of public claim revisions and their currently public citations. The supported, contradicted, unresolved, and outdated transitions express supersession history; no additional timeline status is invented. Private claims, revisions, entities, sources, documents, and document versions are omitted.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "claimKey",
            in: "path",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 200 },
          },
          { $ref: "#/components/parameters/Limit" },
        ],
        responses: {
          "200": {
            description:
              "At most 50 deterministic public revision entries, newest first.",
          },
          "401": { description: "Missing or invalid access token." },
          "403": { description: "The evidence scope is required." },
          "429": { description: "Quota or rate limit reached." },
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
        summary: "List versioned evidence datasets and measurable coverage",
        description:
          "Returns each public dataset's explicit document/source/license selection plus its latest immutable snapshot checksum, schema version, byte size, source and citation counts, completeness and freshness scores, and temporal coverage. Empty arrays mean no selection restriction; null means no completed snapshot yet.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Current public evidence datasets and latest snapshot quality metrics.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/EvidenceDataset" },
                },
              },
            },
          },
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
    "/v1/exports/{jobId}/manifest": {
      get: {
        operationId: "getEvidenceExportManifest",
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
              "Authenticated first-party immutable JSON manifest containing selection, checksum, bounded-scan disclosure, provenance distributions, citation coverage, completeness, freshness, and temporal coverage.",
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
    "/v1/webhooks/availability": {
      get: {
        operationId: "getEvidenceWebhookAvailability",
        summary: "Check whether the owner can configure delivery",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "Delivery availability; destination allowlists are never returned.",
          },
        },
      },
    },
    "/v1/webhooks/{subscriptionKey}/health": {
      get: {
        operationId: "getEvidenceWebhookHealth",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/SubscriptionKey" }],
        responses: {
          "200": { description: "Bounded owner-scoped delivery counters." },
        },
      },
    },
    "/v1/webhooks/{subscriptionKey}/deliveries": {
      get: {
        operationId: "listEvidenceWebhookDeliveries",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/SubscriptionKey" },
          { $ref: "#/components/parameters/Limit" },
        ],
        responses: {
          "200": {
            description: "Bounded, secret-free owner-scoped delivery history.",
          },
        },
      },
    },
    "/v1/webhooks/{subscriptionKey}/rotate": {
      post: {
        operationId: "rotateEvidenceWebhookSecret",
        description:
          "Returns a replacement signing secret exactly once. Store it outside chat, logs, URLs, and source control.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/SubscriptionKey" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        responses: {
          "200": {
            description: "Replacement secret shown only in this response.",
          },
        },
      },
    },
    "/v1/webhooks/{subscriptionKey}/deliveries/{eventKey}/replay": {
      post: {
        operationId: "replayEvidenceWebhookDelivery",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/SubscriptionKey" },
          {
            name: "eventKey",
            in: "path",
            required: true,
            schema: { type: "string", maxLength: 160 },
          },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        responses: {
          "200": {
            description:
              "Eligible failed/dead-letter delivery was queued for replay.",
          },
        },
      },
    },
    "/v1/webhooks/{subscriptionKey}/test": {
      post: {
        operationId: "sendEvidenceWebhookTest",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/SubscriptionKey" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["eventType"],
                properties: { eventType: { type: "string" } },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": { description: "Synthetic, bounded delivery was queued." },
        },
      },
    },
    "/mcp": {
      post: {
        operationId: "evidenceMcp",
        summary: "Call the stateless MCP evidence server",
        description:
          "Protocol 2026-07-28 uses server/discover and per-request metadata. Legacy 2025-03-26 initialize remains available only for legacy callers. Initialize, discovery, tool listing, and the read-only MCP App resource are public; tools/call requires the documented custom Ed25519 bearer flow, not OAuth authorization endpoints.",
        security: [{}, { bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/McpProtocolVersion" },
          { $ref: "#/components/parameters/McpMethod" },
          { $ref: "#/components/parameters/McpName" },
        ],
        responses: {
          "200": {
            description:
              "JSON-RPC server/discover, tools/list, resources/list, resources/read, tools/call, or legacy initialize response.",
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
      SubscriptionKey: {
        name: "subscriptionKey",
        in: "path",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 96 },
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
      SemanticIdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: {
          type: "string",
          minLength: 8,
          maxLength: 96,
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
      EvidenceDataset: {
        type: "object",
        required: [
          "datasetId",
          "datasetKey",
          "name",
          "description",
          "licenseClass",
          "exportSchemaVersion",
          "selection",
          "latestVersion",
        ],
        properties: {
          datasetId: { type: "string" },
          datasetKey: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          licenseClass: { type: "string" },
          exportSchemaVersion: { type: "string" },
          selection: {
            type: "object",
            required: ["includedKinds", "includedLicenseClasses", "sourceKeys"],
            properties: {
              includedKinds: { type: "array", items: { type: "string" } },
              includedLicenseClasses: { type: "array", items: { type: "string" } },
              sourceKeys: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
          latestVersion: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                required: [
                  "datasetVersionId",
                  "version",
                  "checksum",
                  "recordCount",
                  "schemaVersion",
                  "artifactByteLength",
                  "sourceCount",
                  "citationCount",
                  "completenessScore",
                  "freshnessScore",
                  "earliestObservedAt",
                  "latestObservedAt",
                  "createdAt",
                ],
                properties: {
                  datasetVersionId: { type: "string" },
                  version: { type: "string" },
                  checksum: { type: "string" },
                  recordCount: { type: "integer", minimum: 0 },
                  schemaVersion: { type: "string" },
                  artifactByteLength: { type: "integer", minimum: 0 },
                  sourceCount: { type: "integer", minimum: 0 },
                  citationCount: { type: "integer", minimum: 0 },
                  completenessScore: { type: "integer", minimum: 0, maximum: 100 },
                  freshnessScore: { type: "integer", minimum: 0, maximum: 100 },
                  earliestObservedAt: { type: ["number", "null"] },
                  latestObservedAt: { type: ["number", "null"] },
                  createdAt: { type: "number" },
                },
                additionalProperties: false,
              },
            ],
          },
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
                "evidence.usage.threshold_reached",
                "evidence.usage.budget_reached",
                "evidence.entitlement.status_changed",
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

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

const PUBLISHED_OPENAPI = withCompleteOperationDocumentation(OPENAPI);

function withCompleteOperationDocumentation<T>(source: T): T {
  const document = structuredClone(source) as T & {
    paths: Record<string, Record<string, unknown>>;
  };
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, candidate] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !isOpenApiOperation(candidate)) continue;
      const summary =
        typeof candidate.summary === "string" && candidate.summary.trim()
          ? candidate.summary
          : humanizeOperationId(candidate.operationId);
      candidate.summary = summary;
      if (
        typeof candidate.description !== "string" ||
        candidate.description.trim().length === 0
      ) {
        candidate.description = `${summary}. Calls ${method.toUpperCase()} ${path} under the published authentication, scope, quota, visibility, and structured-error contract where applicable.`;
      }
    }
  }
  return document;
}

function isOpenApiOperation(
  value: unknown,
): value is Record<string, unknown> & { operationId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).operationId === "string"
  );
}

function humanizeOperationId(operationId: string) {
  const words = operationId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function GET() {
  return new Response(`${JSON.stringify(PUBLISHED_OPENAPI, null, 2)}\n`, {
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
