import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "SYMBaiEX Synthetic API Sandbox",
    version: "1.0.0",
    description:
      "Credential-free, read-only endpoints backed only by deterministic synthetic fixtures. Never send production credentials to this server.",
    termsOfService: primarySiteUrl("/terms"),
    contact: { url: primarySiteUrl("/contact") },
  },
  servers: [
    {
      url: primarySiteUrl("/api/sandbox"),
      description: "Synthetic read-only sandbox; no production data or writes",
      "x-environment": "sandbox",
      "x-synthetic-only": true,
    },
  ],
  security: [],
  paths: {
    "/v1/status": {
      get: {
        operationId: "getSandboxStatus",
        summary: "Read sandbox availability and fixture count",
        tags: ["Sandbox"],
        security: [],
        responses: {
          "200": {
            description: "Synthetic sandbox status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SandboxStatus" },
              },
            },
          },
        },
      },
    },
    "/v1/search": {
      get: {
        operationId: "searchSandboxFixtures",
        summary: "Search deterministic synthetic fixtures",
        description:
          "Returns only synthetic document, claim, and entity fixtures. It never reads production records.",
        tags: ["Sandbox"],
        security: [],
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 200 },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              default: 10,
            },
          },
        ],
        responses: {
          "200": {
            description: "Bounded synthetic search results",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SandboxSearchResults" },
              },
            },
          },
          "400": { $ref: "#/components/responses/StructuredError" },
        },
      },
    },
  },
  components: {
    schemas: {
      SandboxStatus: {
        type: "object",
        additionalProperties: false,
        required: [
          "environment",
          "status",
          "syntheticOnly",
          "writesEnabled",
          "fixtureCount",
        ],
        properties: {
          environment: { type: "string", const: "sandbox" },
          status: { type: "string", const: "ready" },
          syntheticOnly: { type: "boolean", const: true },
          writesEnabled: { type: "boolean", const: false },
          fixtureCount: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
      SandboxFixture: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "title", "excerpt", "canonicalUrl"],
        properties: {
          id: { type: "string", pattern: "^sandbox-", maxLength: 128 },
          type: { type: "string", enum: ["document", "claim", "entity"] },
          title: { type: "string", maxLength: 200 },
          excerpt: { type: "string", maxLength: 500 },
          canonicalUrl: { type: "string", format: "uri", maxLength: 2_000 },
        },
      },
      SandboxSearchResults: {
        type: "object",
        additionalProperties: false,
        required: ["environment", "syntheticOnly", "results"],
        properties: {
          environment: { type: "string", const: "sandbox" },
          syntheticOnly: { type: "boolean", const: true },
          results: {
            type: "array",
            maxItems: 10,
            items: { $ref: "#/components/schemas/SandboxFixture" },
          },
        },
      },
      StructuredError: {
        type: "object",
        additionalProperties: false,
        required: ["error", "code", "resolution"],
        properties: {
          error: { type: "string", maxLength: 500 },
          code: { type: "string", pattern: "^[A-Z][A-Z0-9_]{1,63}$" },
          resolution: { type: "string", maxLength: 1_000 },
        },
      },
    },
    responses: {
      StructuredError: {
        description: "Structured sandbox request error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/StructuredError" },
          },
        },
      },
    },
  },
} as const;

export function GET() {
  return new Response(`${JSON.stringify(OPENAPI, null, 2)}\n`, {
    headers: contractHeaders(),
  });
}

export function HEAD() {
  return new Response(null, { headers: contractHeaders() });
}

function contractHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD",
    "Cache-Control": "public, max-age=3600, s-maxage=86400",
    "Content-Type":
      "application/vnd.oai.openapi+json;version=3.1; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-SYMBaiEX-Environment": "sandbox",
  };
}
