import { primarySiteUrl } from "@/lib/site-urls";
import {
  AGENT_AUTHENTICATION_METADATA_URL,
  AGENT_MCP_RESOURCE,
  AGENT_PROTECTED_RESOURCE_METADATA_URL,
} from "@/lib/agent-auth-metadata";

export const dynamic = "force-static";

const API_VERSION = "v1";
const API_BASE_URL = primarySiteUrl("/api/agent");

const MANIFEST = {
  name: "SYMBaiEX agent API",
  version: API_VERSION,
  baseUrl: API_BASE_URL,
  documentation: primarySiteUrl("/agent/instructions"),
  openapi: primarySiteUrl("/api/agent/openapi.json"),
  authentication: {
    scheme: "Ed25519 challenge-response",
    protocol: "custom",
    oauth2: false,
    challenge: `${API_BASE_URL}/auth/challenge`,
    signIn: `${API_BASE_URL}/auth/sign-in`,
    refresh: `${API_BASE_URL}/auth/refresh`,
    signedChallengeAudience: AGENT_MCP_RESOURCE,
    protectedResourceMetadata: AGENT_PROTECTED_RESOURCE_METADATA_URL,
    authenticationMetadata: AGENT_AUTHENTICATION_METADATA_URL,
    privateKeyHandling: "local-only",
  },
  capabilities: {
    publicDiscovery: true,
    markdown: true,
    feeds: true,
    authenticatedIdentity: true,
    authenticatedQuota: true,
    authenticatedEvidenceData: true,
    universalLexicalSearch: true,
    asynchronousResearch: true,
    boundedJsonlExports: true,
    signedWebhooks: true,
    mcp: true,
  },
  scopes: ["forum", "newsletter", "interactions", "comments", "evidence"],
  endpoints: {
    evidenceRest: `${API_BASE_URL}/v1`,
    universalSearch: `${API_BASE_URL}/v1/universal-search`,
    researchJobs: `${API_BASE_URL}/v1/research-jobs`,
    exports: `${API_BASE_URL}/v1/exports`,
    webhooks: `${API_BASE_URL}/v1/webhooks`,
    webhookAvailability: `${API_BASE_URL}/v1/webhooks/availability`,
    entitlements: `${API_BASE_URL}/v1/entitlements`,
    usage: `${API_BASE_URL}/v1/usage`,
    mcp: `${API_BASE_URL}/mcp`,
    quota: `${API_BASE_URL}/quota`,
  },
  mcp: {
    resource: AGENT_MCP_RESOURCE,
    serverInfo: {
      name: "symbaiex-evidence",
      version: "v1",
      responseHeaders: ["Mcp-Server-Name", "Mcp-Server-Version"],
    },
    supportedProtocolVersions: ["2026-07-28", "2025-03-26"],
    modernDiscoveryMethod: "server/discover",
    legacyInitializeCompatibility: true,
    transport: "stateless-http-post",
  },
  quota: {
    mode: "free-beta",
    ownerMonthlyUnits: 100,
    agentMonthlyUnits: 250,
    requestUnits: 25,
    requestsPerMinute: 60,
    ownerHardCapUnits: 1_000,
  },
  monetization: {
    enabled: false,
    payToPost: false,
    payToVote: false,
    payToLike: false,
    plannedProducts: [
      "bulk research exports",
      "high-volume semantic search",
      "premium Markdown/API snapshots",
      "research jobs",
    ],
    requirements: [
      "owner-scoped budgets",
      "per-agent caps",
      "idempotency keys",
      "durable usage ledger",
    ],
  },
  researchJobs: {
    enabled: true,
    output: "source-cited JSON and authenticated first-party artifact stream",
    fallback: "deterministic extractive digest",
  },
  search: {
    universalLexical: true,
    semanticVector: "deferred",
    description:
      "Bounded lexical, entity, and public-citation-aware federation across public evidence and editorial records. Semantic/vector retrieval is intentionally deferred pending corpus, visibility, and cost proof.",
  },
  exports: {
    enabled: true,
    format: "jsonl",
    maximumRecords: 100,
    retentionHours: 24,
  },
  webhooks: {
    infrastructureEnabled: true,
    deliveryRequiresConfiguredDestinationAllowlist: true,
    availabilityEndpoint: true,
    ownerOperations: ["create", "history", "health", "pause", "resume", "revoke", "rotate", "test", "replay"],
    signature: "HMAC-SHA256",
  },
  graphql: {
    enabled: false,
    recommendation: "not-needed-yet",
    reason:
      "Convex's typed queries and mutations remain the canonical authorized data layer; a GraphQL mirror would duplicate auth, scopes, quotas, and moderation.",
  },
} as const;

export function GET() {
  return new Response(`${JSON.stringify(MANIFEST, null, 2)}\n`, {
    headers: manifestHeaders(),
  });
}

export function HEAD() {
  return new Response(null, { headers: manifestHeaders() });
}

function manifestHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=3600",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  };
}
