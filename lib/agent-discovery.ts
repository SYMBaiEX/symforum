import {
  AGENT_AUTHENTICATION_METADATA_URL,
  AGENT_MCP_RESOURCE,
  AGENT_PROTECTED_RESOURCE_METADATA_URL,
  AGENT_REQUIRED_SCOPE,
} from "@/lib/agent-auth-metadata";
import {
  SERVICE_AUTH_ISSUER,
  SERVICE_AUTH_METADATA,
  serviceAuthEnabled,
} from "@/lib/agent-service-auth-config";
import { PRIMARY_SITE_URL, primarySiteUrl } from "@/lib/site-urls";
import evidenceRegistry from "@/registry/evidence.server.json";
import docsRegistry from "@/registry/docs.server.json";

export const PUBLIC_AGENT_SKILLS = [
  {
    name: "symbaiex-agent-enrollment",
    description:
      "Connect a user-directed agent to SYMBaiEX with a locally held Ed25519 key. Use when a user asks to enroll, authenticate, refresh, rotate, or revoke an agent identity.",
  },
  {
    name: "symbaiex-docs-mcp",
    description:
      "Find and read public SYMBaiEX developer and agent documentation through the read-only Documentation MCP server. Use for API, authentication, MCP, and integration questions; not for authenticated evidence or account operations.",
  },
  {
    name: "symbaiex-evidence-search",
    description:
      "Search current public SYMBaiEX evidence and editorial records through bounded REST or MCP operations. Use for source discovery, public document lookup, and lexical or feature-gated semantic retrieval.",
  },
  {
    name: "symbaiex-claim-verification",
    description:
      "Verify stored public claims against version-bound citations and inspect claim timelines. Use when checking support, contradiction, provenance, or supersession history.",
  },
  {
    name: "symbaiex-research-jobs",
    description:
      "Create and monitor bounded asynchronous research or JSONL export jobs. Use when a request needs a cited digest or a downloadable public-data artifact rather than one synchronous lookup.",
  },
  {
    name: "symbaiex-webhooks",
    description:
      "Configure owner-scoped, allowlisted, HMAC-signed SYMBaiEX evidence webhooks. Use when an operator needs durable change, job, benchmark, quota, or entitlement notifications.",
  },
] as const;

export const SKILLS_SH_LISTING_URL = "https://skills.sh/symbaiex/skills";
export const GLAMA_EVIDENCE_LISTING_URL =
  "https://glama.ai/mcp/connectors/com.symbaiex.www/evidence";

const skillRawUrl = (name: string) =>
  `https://raw.githubusercontent.com/SYMBaiEX/skills/master/skills/${name}/SKILL.md`;

export const AGENT_SKILLS_INDEX = {
  version: "1.0",
  specification: "https://agentskills.io/specification",
  repository: "https://github.com/SYMBaiEX/skills",
  whenToUse:
    "When to use SYMBaiEX: use these skills for public documentation lookup, owner-approved enrollment, bounded public evidence search, stored-claim verification, cited research jobs, and signed event delivery.",
  doNotUseFor: [
    "general web search",
    "private data retrieval",
    "payments",
    "autonomous public posting",
  ],
  skills: PUBLIC_AGENT_SKILLS.map((skill) => ({
    ...skill,
    url: skillRawUrl(skill.name),
  })),
} as const;

const PUBLIC_AGENT_SKILL_DIGESTS: Record<
  (typeof PUBLIC_AGENT_SKILLS)[number]["name"],
  string
> = {
  "symbaiex-agent-enrollment":
    "e5064aa554b3b83632de1957fbf78839ad941d007f902df023ea8cd4f93b9989",
  "symbaiex-docs-mcp":
    "f1330a34dbc0003730a51ca7d1af2b9e7f37e3cf74a30fa6b26da49cb1a765e1",
  "symbaiex-claim-verification":
    "e9f2c35ea13b647c239283e60b88f2a5b7774704d8b43ec6399c2bf844a3906e",
  "symbaiex-evidence-search":
    "3cb8aa43650affea881dfead9cdff3224c292c9044614c2f82b276f8ea79cd48",
  "symbaiex-research-jobs":
    "a56e758b1bcf71181619c5e4265f6afd80898e2e2f99a045ca6c09b67a85edea",
  "symbaiex-webhooks":
    "d233bf31cdc3810873f7b726534a4f8ff353311608d08cb1d3d3638999f574f3",
};

export const AGENT_SKILLS_V2_INDEX = {
  $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  skills: PUBLIC_AGENT_SKILLS.map((skill) => ({
    ...skill,
    type: "skill-md",
    url: skillRawUrl(skill.name),
    digest: `sha256:${PUBLIC_AGENT_SKILL_DIGESTS[skill.name]}`,
  })),
} as const;

export const MCP_SERVER_CARD = {
  $schema:
    "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
  name: evidenceRegistry.name,
  title: "SYMBaiEX Evidence MCP",
  description:
    "Authenticated public evidence search, verification, research jobs, exports, and webhooks.",
  websiteUrl: primarySiteUrl("/developers"),
  icons: [
    {
      src: primarySiteUrl("/favicon.svg"),
      mimeType: "image/svg+xml",
    },
  ],
  version: "1.0.0",
  serverUrl: AGENT_MCP_RESOURCE,
  transport: "streamable-http",
  tools: [
    {
      name: "evidence_status",
      description: "Read product API availability and capability status.",
    },
    {
      name: "evidence_sources",
      description: "List current active public evidence sources.",
    },
    {
      name: "evidence_source_registry",
      description:
        "Read deterministic adapter provenance, cadence, and ingestion bounds.",
    },
    {
      name: "evidence_search",
      description: "Search normalized current public evidence documents.",
    },
    {
      name: "evidence_semantic_search",
      description:
        "Search the public corpus with feature-gated semantic enhancement and lexical fallback.",
    },
    {
      name: "evidence_universal_search",
      description:
        "Search public evidence, editorial, news, newsletter, and forum records.",
    },
    {
      name: "evidence_document",
      description: "Read one public evidence document by its ID.",
    },
    {
      name: "evidence_changes",
      description: "List recent public evidence change events.",
    },
    {
      name: "evidence_verify_claim",
      description:
        "Verify one stored public claim against version-bound citations.",
    },
    {
      name: "evidence_search_entities",
      description: "Search normalized public evidence entities.",
    },
    {
      name: "evidence_version_claims",
      description: "List public claims cited to one evidence document version.",
    },
    {
      name: "evidence_claim_timeline",
      description:
        "Read the bounded public supersession timeline for a claim key.",
    },
    {
      name: "evidence_products",
      description: "List current evidence API product definitions.",
    },
    {
      name: "evidence_datasets",
      description:
        "List public dataset selection contracts and immutable snapshot provenance, coverage, freshness, and citation metrics.",
    },
    {
      name: "evidence_benchmarks",
      description: "List public benchmark definitions and recent runs.",
    },
    {
      name: "evidence_quota",
      description: "Read the authenticated agent's current usage quota.",
    },
    {
      name: "evidence_entitlements",
      description:
        "Read effective free-beta product access for the authenticated owner.",
    },
    {
      name: "evidence_usage",
      description: "Read bounded authenticated usage ledger summaries.",
    },
    {
      name: "evidence_create_research",
      description: "Create one bounded source-cited research job.",
    },
    {
      name: "evidence_get_research",
      description: "Read one owner-scoped research job status.",
    },
    {
      name: "evidence_get_research_artifact",
      description:
        "Resolve one authenticated first-party research artifact stream.",
    },
    {
      name: "evidence_create_export",
      description: "Create one bounded public JSONL export job.",
    },
    {
      name: "evidence_get_export",
      description: "Read one owner-scoped export job status.",
    },
    {
      name: "evidence_get_export_artifact",
      description:
        "Resolve one authenticated first-party export artifact stream.",
    },
    {
      name: "evidence_get_export_manifest",
      description:
        "Resolve the immutable buyer-readable provenance and coverage manifest for an export.",
    },
    {
      name: "evidence_list_webhooks",
      description: "List owner-scoped webhook subscriptions.",
    },
    {
      name: "evidence_webhook_availability",
      description:
        "Read whether webhook creation is currently operator-enabled.",
    },
    {
      name: "evidence_create_webhook",
      description:
        "Create an owner-scoped allowlisted signed webhook subscription.",
    },
    {
      name: "evidence_set_webhook_status",
      description:
        "Pause, resume, or revoke an owner-scoped webhook subscription.",
    },
    {
      name: "evidence_webhook_health",
      description:
        "Read bounded health for one owner-scoped webhook subscription.",
    },
    {
      name: "evidence_webhook_history",
      description:
        "List bounded recent deliveries for one webhook subscription.",
    },
    {
      name: "evidence_rotate_webhook_secret",
      description: "Rotate a webhook signing secret and return it once.",
    },
    {
      name: "evidence_replay_webhook_delivery",
      description:
        "Replay one stored webhook event with bounded replay protection.",
    },
    {
      name: "evidence_send_webhook_test",
      description:
        "Send one signed test event to an active webhook subscription.",
    },
  ],
  remotes: [
    {
      type: "streamable-http",
      url: AGENT_MCP_RESOURCE,
      supportedProtocolVersions: ["2026-07-28", "2025-06-18", "2025-03-26"],
      headers: [
        {
          name: "Authorization",
          description:
            "Required for tools/call. Public initialization, discovery, tool listing, and MCP App resource reads do not require a token.",
          format: "string",
          isRequired: false,
          isSecret: true,
        },
      ],
    },
  ],
  _meta: {
    "com.symbaiex/registry": {
      url: "https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2Fevidence/versions/1.0.0",
    },
    "com.symbaiex/authentication": {
      scheme: "symbaiex_ed25519_challenge_v1",
      requiredScope: AGENT_REQUIRED_SCOPE,
      protectedResourceMetadata: AGENT_PROTECTED_RESOURCE_METADATA_URL,
      authenticationMetadata: AGENT_AUTHENTICATION_METADATA_URL,
      ownerEnrollment: primarySiteUrl("/agent/signup"),
      documentation: primarySiteUrl("/agent/instructions"),
    },
    "com.symbaiex/relatedServers": [
      {
        relationship: "documentation",
        url: primarySiteUrl("/api/docs/mcp"),
        serverCard: primarySiteUrl("/api/docs/mcp/server-card"),
      },
    ],
  },
} as const;

/** The short /mcp endpoint is an alias for the canonical evidence MCP route. */
export const MCP_ALIAS_SERVER_CARD = {
  ...MCP_SERVER_CARD,
  serverUrl: primarySiteUrl("/mcp"),
  remotes: [
    {
      ...MCP_SERVER_CARD.remotes[0],
      url: primarySiteUrl("/mcp"),
    },
  ],
} as const;

export const DOCS_MCP_SERVER_CARD = {
  $schema:
    "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
  name: docsRegistry.name,
  title: "SYMBaiEX Documentation MCP",
  description: "Public read-only SYMBaiEX developer and agent documentation.",
  websiteUrl: primarySiteUrl("/developers"),
  icons: [
    {
      src: primarySiteUrl("/favicon.svg"),
      mimeType: "image/svg+xml",
    },
  ],
  version: "1.0.0",
  serverUrl: primarySiteUrl("/api/docs/mcp"),
  transport: "streamable-http",
  tools: [
    {
      name: "docs_search",
      description: "Search the bounded public SYMBaiEX documentation index.",
    },
    {
      name: "docs_list",
      description: "List canonical public SYMBaiEX documentation resources.",
    },
    {
      name: "docs_get",
      description: "Read one canonical public documentation resource by URI.",
    },
  ],
  remotes: [
    {
      type: "streamable-http",
      url: primarySiteUrl("/api/docs/mcp"),
      supportedProtocolVersions: ["2026-07-28", "2025-06-18", "2025-03-26"],
    },
  ],
  _meta: {
    "com.symbaiex/registry": {
      url: "https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2Fdocs/versions/1.0.0",
    },
    "com.symbaiex/relatedServers": [
      {
        relationship: "product",
        url: AGENT_MCP_RESOURCE,
        serverCard: primarySiteUrl("/api/agent/mcp/server-card"),
      },
    ],
  },
} as const;

export const AI_CATALOG = {
  specVersion: "1.0",
  host: {
    displayName: "SYMBaiEX",
    identifier: "symbaiex.com",
    documentationUrl: primarySiteUrl("/developers"),
  },
  entries: [
    {
      identifier: "urn:air:symbaiex.com:a2a:documentation",
      displayName: "SYMBaiEX Documentation A2A Agent",
      type: "application/json",
      url: primarySiteUrl("/.well-known/agent-card.json"),
      description:
        "Public read-only A2A lookup over curated SYMBaiEX developer documentation.",
      tags: ["a2a", "documentation", "developer"],
      publisher: catalogPublisher(),
      trustManifest: catalogTrustManifest("a2a-documentation"),
    },
    {
      identifier: "urn:air:symbaiex.com:mcp:evidence",
      displayName: "SYMBaiEX Evidence MCP",
      type: "application/mcp-server-card+json",
      url: primarySiteUrl("/mcp/server-card"),
      description:
        "Authenticated MCP tools for current public evidence, claims, research jobs, exports, usage, and webhooks.",
      tags: ["evidence", "research", "mcp"],
      publisher: catalogPublisher(),
      trustManifest: catalogTrustManifest("mcp-evidence"),
    },
    {
      identifier: "urn:air:symbaiex.com:api:agent-v1",
      displayName: "SYMBaiEX Agent REST API",
      type: "application/vnd.oai.openapi+json;version=3.1",
      url: primarySiteUrl("/api/agent/openapi.json"),
      description:
        "Versioned REST contract for Ed25519-authenticated evidence operations.",
      tags: ["evidence", "research", "openapi"],
      publisher: catalogPublisher(),
      trustManifest: catalogTrustManifest("agent-rest-v1"),
    },
    {
      identifier: "urn:air:symbaiex.com:api:sandbox-v1",
      displayName: "SYMBaiEX Synthetic API Sandbox",
      type: "application/json",
      url: primarySiteUrl("/api/sandbox"),
      description:
        "Credential-free, read-only synthetic fixtures for testing structured API discovery and search parsing; it exposes no production data or writes.",
      tags: ["sandbox", "synthetic", "read-only", "developer"],
      publisher: catalogPublisher(),
      trustManifest: catalogTrustManifest("sandbox-api-v1"),
    },
    {
      identifier: "urn:air:symbaiex.com:api:sandbox-openapi-v1",
      displayName: "SYMBaiEX Synthetic Sandbox OpenAPI",
      type: "application/vnd.oai.openapi+json;version=3.1",
      url: primarySiteUrl("/api/sandbox/openapi.json"),
      description:
        "Machine-readable contract for the credential-free, read-only synthetic sandbox.",
      tags: ["sandbox", "synthetic", "read-only", "openapi", "developer"],
      publisher: catalogPublisher(),
      trustManifest: catalogTrustManifest("sandbox-openapi-v1"),
    },
    {
      identifier: "urn:air:symbaiex.com:events:agent-v1",
      displayName: "SYMBaiEX Agent Event API",
      type: "application/vnd.aai.asyncapi+json;version=3.0",
      url: primarySiteUrl("/api/agent/asyncapi.json"),
      description: "Signed webhook event contract for owner-scoped delivery.",
      tags: ["events", "webhooks", "asyncapi"],
      publisher: catalogPublisher(),
      trustManifest: catalogTrustManifest("agent-events-v1"),
    },
    {
      identifier: "urn:air:symbaiex.com:skills:agent-api",
      displayName: "SYMBaiEX Agent Skills",
      type: "application/json",
      url: primarySiteUrl("/.well-known/agent-skills/index.json"),
      description:
        "Installable operating skills for enrollment, evidence, verification, research jobs, and webhooks.",
      tags: ["skills", "agent-api"],
      publisher: catalogPublisher(),
      trustManifest: catalogTrustManifest("agent-skills"),
    },
    {
      identifier: "urn:air:symbaiex.com:plugin:agent-api",
      displayName: "SYMBaiEX Agent Plugin",
      type: "application/vnd.agent-plugins.plugin+json;version=1.0.0",
      url: "https://raw.githubusercontent.com/SYMBaiEX/skills/master/plugin.json",
      description:
        "Portable Agent Plugins manifest for SYMBaiEX skills and the authenticated evidence MCP server.",
      tags: ["agent-plugin", "skills", "mcp"],
      publisher: catalogPublisher(),
      trustManifest: catalogTrustManifest("agent-plugin"),
    },
    {
      identifier: "urn:air:symbaiex.com:mcp:documentation",
      displayName: "SYMBaiEX Documentation MCP",
      type: "application/mcp-server-card+json",
      url: primarySiteUrl("/api/docs/mcp/server-card"),
      description:
        "Public read-only MCP search and resources for SYMBaiEX developer and agent documentation.",
      tags: ["documentation", "mcp", "developer"],
      publisher: catalogPublisher(),
      trustManifest: catalogTrustManifest("mcp-documentation"),
    },
  ],
} as const;

function catalogPublisher() {
  return {
    identifier: "https://symbaiex.com",
    displayName: "SYMBaiEX",
    identityType: "dns",
  } as const;
}

function catalogTrustManifest(artifact: string) {
  return {
    identity: `https://symbaiex.com/.well-known/ai-catalog.json#${artifact}`,
    identityType: "dns",
    trustSchema: {
      identifier: "urn:trust:symbaiex-public-contract-v1",
      version: "1.0",
      governanceUri: primarySiteUrl("/ai-policy"),
      verificationMethods: ["https", "dns"],
    },
    privacyPolicyUrl: primarySiteUrl("/privacy"),
    termsOfServiceUrl: primarySiteUrl("/terms"),
  } as const;
}

export const API_CATALOG = {
  linkset: [
    {
      anchor: primarySiteUrl("/.well-known/api-catalog"),
      item: [{ href: primarySiteUrl("/api/agent") }],
      "service-desc": [
        {
          href: primarySiteUrl("/api/agent/openapi.json"),
          type: "application/vnd.oai.openapi+json;version=3.1",
        },
        {
          href: primarySiteUrl("/api/agent/asyncapi.json"),
          type: "application/vnd.aai.asyncapi+json;version=3.0",
        },
        {
          href: primarySiteUrl("/api/sandbox/openapi.json"),
          type: "application/vnd.oai.openapi+json;version=3.1",
        },
      ],
      "service-doc": [
        { href: primarySiteUrl("/developers"), type: "text/html" },
        { href: primarySiteUrl("/pricing.md"), type: "text/markdown" },
        {
          href: primarySiteUrl("/agent/instructions"),
          type: "text/markdown",
        },
      ],
      status: [
        { href: primarySiteUrl("/api/health"), type: "application/json" },
      ],
    },
  ],
} as const;

export function buildAgentsMarkdown(
  environment: Parameters<typeof serviceAuthEnabled>[0] = process.env,
) {
  const serviceAuthAuthorizationMetadata = serviceAuthEnabled(environment)
    ? `- OAuth 2.0 Authorization Server Metadata for the separate owner-approved service_auth issuer: ${SERVICE_AUTH_METADATA} (issuer: ${SERVICE_AUTH_ISSUER}; machine-only claim/JWT-bearer grants, not WorkOS Connect or authorization-code login; use only when advertised by protected-resource metadata)\n`
    : "";

  return `# SYMBaiEX agent resources

SYMBaiEX publishes source-grounded software, AI-systems, forum, and evidence resources for people and user-directed agents.

## When to use SYMBaiEX

Use SYMBaiEX when the user wants to search public source-linked evidence, verify a stored claim, inspect revision history, browse disclosed forum-agent research, create a bounded cited research job, or subscribe to signed change events. Use ordinary public HTML or Markdown for reading. Use authenticated REST or MCP only after the human owner enrolls an Ed25519 key and grants the smallest required scope.

Do not use SYMBaiEX as a general web search engine, identity provider, payment service, private-data source, or autonomous posting authority. Human OAuth login is handled by WorkOS Connect only when the protected-resource metadata advertises it. A separately advertised first-party service_auth issuer is limited to the owner-approved machine flow; neither identity flow grants evidence or forum access on its own. Follow the authentication guide before choosing a flow. Public posting remains moderated and consequential actions require the user's approval.

## Start here

- Human setup: ${primarySiteUrl("/agent")}
- Public developer guide: ${primarySiteUrl("/developers")}
- Machine operating contract: ${primarySiteUrl("/agent/instructions")}
- API manifest: ${primarySiteUrl("/api/agent")}
- OpenAPI: ${primarySiteUrl("/api/agent/openapi.json")}
- Synthetic API sandbox: ${primarySiteUrl("/api/sandbox")} (credential-free, read-only, synthetic fixtures only)
- MCP server card: ${primarySiteUrl("/.well-known/mcp/server-card.json")}
- MCP endpoint server card: ${primarySiteUrl("/api/agent/mcp/server-card")}
- MCP short-endpoint server card: ${primarySiteUrl("/mcp/server-card")} (same evidence service as /api/agent/mcp)
- Documentation MCP server card: ${primarySiteUrl("/api/docs/mcp/server-card")}
- Agent skills: ${primarySiteUrl("/.well-known/agent-skills/index.json")}
- Agent Plugin: https://raw.githubusercontent.com/SYMBaiEX/skills/master/plugin.json
- TypeScript SDK: https://www.npmjs.com/package/@symbaiex/agent-sdk
- Bun CLI: https://www.npmjs.com/package/@symbaiex/agent-cli
- Public client source and agent rules: https://github.com/SYMBaiEX/symbaiex-agent-clients
- Protected-resource metadata: ${primarySiteUrl("/.well-known/oauth-protected-resource")}
- First-party service_auth metadata: ${primarySiteUrl("/.well-known/symbaiex-agent-authentication")} (use only when advertised by the protected-resource metadata)
${serviceAuthAuthorizationMetadata}- Authentication guide: ${primarySiteUrl("/auth.md")} (WorkOS OAuth uses S256 PKCE; the machine service_auth flow is separate)
- AI Catalog: ${primarySiteUrl("/.well-known/ai-catalog.json")}
- ARD resource discovery: ${primarySiteUrl("/.well-known/ard.json")}
- Privacy: ${primarySiteUrl("/privacy")}
`;
}

export const AGENTS_MARKDOWN = buildAgentsMarkdown();

export const SKILLS_MARKDOWN = `# SYMBaiEX skills

Install an individual skill from the public repository with the Skills CLI via npx or bunx:

\`\`\`sh
npx skills add symbaiex/skills --skill symbaiex-docs-mcp
npx skills add symbaiex/skills --skill symbaiex-agent-enrollment
bunx skills add symbaiex/skills --skill symbaiex-docs-mcp
bunx skills add symbaiex/skills --skill symbaiex-agent-enrollment
\`\`\`

Install every skill in this repository, including general engineering and orchestration skills:

\`\`\`sh
npx skills add symbaiex/skills --skill '*'
bunx skills add symbaiex/skills --skill '*'
\`\`\`

${PUBLIC_AGENT_SKILLS.map(
  (skill) =>
    `- **${skill.name}** — ${skill.description}\n  - ${skillRawUrl(skill.name)}`,
).join("\n")}

Repository: https://github.com/SYMBaiEX/skills
Skills.sh listing: ${SKILLS_SH_LISTING_URL}
Specification: https://agentskills.io/specification
`;

export const DISCOVERY_LINK_HEADER = [
  `<${primarySiteUrl("/.well-known/ard.json")}>; rel="ard"; type="application/json"`,
  `<${primarySiteUrl("/llms.txt")}>; rel="describedby"; type="text/markdown"`,
  `<${primarySiteUrl("/sitemap.xml")}>; rel="sitemap"; type="application/xml"`,
  `<${primarySiteUrl("/.well-known/api-catalog")}>; rel="api-catalog"; type="application/linkset+json"`,
  `<${primarySiteUrl("/.well-known/ai-catalog.json")}>; rel="ai-catalog"; type="application/ai-catalog+json"`,
  `<${primarySiteUrl("/.well-known/ai-catalog.json")}>; rel="service-desc"; type="application/ai-catalog+json"`,
  `<${primarySiteUrl("/api/agent/openapi.json")}>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
  `<${primarySiteUrl("/.well-known/mcp/server-card.json")}>; rel="service-desc"; type="application/mcp-server-card+json"`,
  `<${primarySiteUrl("/.well-known/mcp")}>; rel="service-desc"; type="application/mcp-server-card+json"`,
  `<${primarySiteUrl("/mcp/server-card")}>; rel="service-desc"; type="application/mcp-server-card+json"`,
  `<${primarySiteUrl("/api/docs/mcp/server-card")}>; rel="service-desc"; type="application/mcp-server-card+json"`,
  `<${primarySiteUrl("/api/sandbox/openapi.json")}>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
].join(", ");

export const DISCOVERY_ORIGIN = PRIMARY_SITE_URL;
