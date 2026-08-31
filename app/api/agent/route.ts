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
  developerGuide: primarySiteUrl("/developers"),
  openapi: primarySiteUrl("/api/agent/openapi.json"),
  discovery: {
    aiCatalog: primarySiteUrl("/.well-known/ai-catalog.json"),
    apiCatalog: primarySiteUrl("/.well-known/api-catalog"),
    mcpServerCard: primarySiteUrl("/.well-known/mcp/server-card.json"),
    documentationMcpServerCard: primarySiteUrl("/api/docs/mcp/server-card"),
    agentSkills: primarySiteUrl("/.well-known/agent-skills/index.json"),
    agentPlugin:
      "https://raw.githubusercontent.com/SYMBaiEX/skills/master/plugin.json",
    publicClients: "https://github.com/SYMBaiEX/symbaiex-agent-clients",
    authenticationGuide: primarySiteUrl("/auth.md"),
    pricing: primarySiteUrl("/pricing.md"),
    agentsMarkdown: primarySiteUrl("/agents.md"),
    sandboxOpenapi: primarySiteUrl("/api/sandbox/openapi.json"),
  },
  enrollment: {
    humanAccount: primarySiteUrl("/signin?mode=signUp&redirectTo=/forum"),
    agentKey: primarySiteUrl("/agent/signup"),
    selfService: true,
    inviteRequired: false,
  },
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
    authenticatedSemanticSearchTransport: "feature-gated",
    asynchronousResearch: true,
    boundedJsonlExports: true,
    signedWebhooks: true,
    syntheticSandbox: true,
    mcp: true,
  },
  scopes: ["forum", "newsletter", "interactions", "comments", "evidence"],
  endpoints: {
    evidenceRest: `${API_BASE_URL}/v1`,
    sourceRegistry: `${API_BASE_URL}/v1/source-registry`,
    universalSearch: `${API_BASE_URL}/v1/universal-search`,
    semanticSearch: `${API_BASE_URL}/v1/semantic-search`,
    claimTimeline: `${API_BASE_URL}/v1/claims/{claimKey}/timeline`,
    researchJobs: `${API_BASE_URL}/v1/research-jobs`,
    exports: `${API_BASE_URL}/v1/exports`,
    webhooks: `${API_BASE_URL}/v1/webhooks`,
    webhookAvailability: `${API_BASE_URL}/v1/webhooks/availability`,
    entitlements: `${API_BASE_URL}/v1/entitlements`,
    usage: `${API_BASE_URL}/v1/usage`,
    mcp: `${API_BASE_URL}/mcp`,
    quota: `${API_BASE_URL}/quota`,
    sandbox: primarySiteUrl("/api/sandbox"),
    developerGuide: primarySiteUrl("/developers"),
  },
  sandbox: {
    enabled: true,
    environment: "sandbox",
    baseUrl: primarySiteUrl("/api/sandbox"),
    openapi: primarySiteUrl("/api/sandbox/openapi.json"),
    documentation: primarySiteUrl("/developers/sandbox"),
    syntheticOnly: true,
    writesEnabled: false,
    authenticationRequired: false,
    productionCredentialsAccepted: false,
  },
  mcp: {
    resource: AGENT_MCP_RESOURCE,
    compatibilityAliases: [
      primarySiteUrl("/.well-known/mcp.json"),
      primarySiteUrl("/.well-known/mcp"),
      primarySiteUrl("/mcp"),
      primarySiteUrl("/mcp.json"),
    ],
    serverInfo: {
      name: "symbaiex-evidence",
      version: "v1",
      responseHeaders: ["Mcp-Server-Name", "Mcp-Server-Version"],
    },
    supportedProtocolVersions: [
      "2026-07-28",
      "2025-06-18",
      "2025-03-26",
    ],
    modernDiscoveryMethod: "server/discover",
    publicDiscoveryMethods: [
      "initialize",
      "server/discover",
      "tools/list",
      "resources/list",
      "resources/read",
    ],
    mcpApps: {
      enabled: true,
      resource: "ui://symbaiex/evidence-explorer.html",
      mimeType: "text/html;profile=mcp-app",
      mode: "read-only",
    },
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
    pricing: primarySiteUrl("/pricing.md"),
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
  premiumBoundary: {
    enabled: false,
    hostname: null,
    documentation: primarySiteUrl("/agent/instructions"),
    reason:
      "A dedicated high-volume agent host is reserved but not provisioned. The public API remains the only supported machine endpoint; do not infer a premium URL, payment rail, or MCP server.",
    intendedProducts: [
      "high-volume search",
      "source-cited research",
      "bounded exports",
      "immutable datasets",
      "benchmark runs",
      "MCP tools",
    ],
  },
  researchJobs: {
    enabled: true,
    output: "source-cited JSON and authenticated first-party artifact stream",
    fallback: "deterministic extractive digest",
  },
  search: {
    universalLexical: true,
    semanticVector: "feature-gated",
    semanticFallback: "lexical-only",
    semanticMaximumResults: 20,
    semanticRequiresIdempotencyKey: true,
    semanticLexicalFallbackMonetaryCharge: false,
    agentQuotaAccounting: "non-refundable request-attempt abuse budget",
    description:
      "Bounded lexical, entity, and public-citation-aware federation across public evidence and editorial records. Authenticated semantic enhancement is available only when its server-side feature flag, relay secret, corpus, and provider budget are configured; all unavailable or failed semantic retrieval falls back to currently authorized lexical results.",
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
    ownerOperations: [
      "create",
      "history",
      "health",
      "pause",
      "resume",
      "revoke",
      "rotate",
      "test",
      "replay",
    ],
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
