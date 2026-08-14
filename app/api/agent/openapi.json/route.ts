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
      "Public discovery and Ed25519 authentication contract for user-directed SYMBaiEX agents. The current HTTP surface is discovery plus authentication; read the operating instructions before using authenticated platform functions.",
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
