import {
  AGENT_AUTHENTICATION_METADATA_URL,
  AGENT_MCP_RESOURCE,
  AGENT_PROTECTED_RESOURCE_METADATA_URL,
  AGENT_REQUIRED_SCOPE,
} from "@/lib/agent-auth-metadata";
import { PRIMARY_SITE_URL, primarySiteUrl } from "@/lib/site-urls";

export const PUBLIC_AGENT_SKILLS = [
  {
    name: "symbaiex-agent-enrollment",
    description:
      "Connect a user-directed agent to SYMBaiEX with a locally held Ed25519 key. Use when a user asks to enroll, authenticate, refresh, rotate, or revoke an agent identity.",
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

const skillRawUrl = (name: string) =>
  `https://raw.githubusercontent.com/SYMBaiEX/symbaiex/main/.agents/skills/${name}/SKILL.md`;

export const AGENT_SKILLS_INDEX = {
  version: "1.0",
  specification: "https://agentskills.io/specification",
  repository: "https://github.com/SYMBaiEX/symbaiex/tree/main/.agents/skills",
  skills: PUBLIC_AGENT_SKILLS.map((skill) => ({
    ...skill,
    url: skillRawUrl(skill.name),
  })),
} as const;

export const MCP_SERVER_CARD = {
  $schema:
    "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
  name: "ai.symbaiex/evidence",
  title: "SYMBaiEX Evidence MCP",
  description:
    "Authenticated public evidence search, verification, research jobs, exports, and webhooks.",
  websiteUrl: primarySiteUrl("/developers"),
  version: "1.0.0",
  repository: {
    source: "github",
    url: "https://github.com/SYMBaiEX/symbaiex",
  },
  remotes: [
    {
      type: "streamable-http",
      url: AGENT_MCP_RESOURCE,
      supportedProtocolVersions: ["2026-07-28", "2025-03-26"],
      headers: [
        {
          name: "Authorization",
          description:
            "Resource-bound bearer token obtained through the documented Ed25519 challenge flow.",
          format: "string",
          isRequired: true,
          isSecret: true,
          placeholder: "Bearer <access-token>",
        },
      ],
    },
  ],
  _meta: {
    "com.symbaiex/authentication": {
      scheme: "symbaiex_ed25519_challenge_v1",
      requiredScope: AGENT_REQUIRED_SCOPE,
      protectedResourceMetadata: AGENT_PROTECTED_RESOURCE_METADATA_URL,
      authenticationMetadata: AGENT_AUTHENTICATION_METADATA_URL,
      ownerEnrollment: primarySiteUrl("/agent/signup"),
      documentation: primarySiteUrl("/agent/instructions"),
    },
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
      identifier: "urn:air:symbaiex.com:mcp:evidence",
      type: "application/mcp-server-card+json",
      url: primarySiteUrl("/api/agent/mcp/server-card"),
      description:
        "Authenticated MCP tools for current public evidence, claims, research jobs, exports, usage, and webhooks.",
      tags: ["evidence", "research", "mcp"],
    },
    {
      identifier: "urn:air:symbaiex.com:api:agent-v1",
      displayName: "SYMBaiEX Agent REST API",
      type: "application/vnd.oai.openapi+json;version=3.1",
      url: primarySiteUrl("/api/agent/openapi.json"),
      description:
        "Versioned REST contract for Ed25519-authenticated evidence operations.",
      tags: ["evidence", "research", "openapi"],
    },
    {
      identifier: "urn:air:symbaiex.com:events:agent-v1",
      displayName: "SYMBaiEX Agent Event API",
      type: "application/vnd.aai.asyncapi+json;version=3.0",
      url: primarySiteUrl("/api/agent/asyncapi.json"),
      description: "Signed webhook event contract for owner-scoped delivery.",
      tags: ["events", "webhooks", "asyncapi"],
    },
    {
      identifier: "urn:air:symbaiex.com:skills:agent-api",
      displayName: "SYMBaiEX Agent Skills",
      type: "application/agent-skills+json",
      url: primarySiteUrl("/.well-known/agent-skills"),
      description:
        "Installable operating skills for enrollment, evidence, verification, research jobs, and webhooks.",
      tags: ["skills", "agent-api"],
    },
  ],
} as const;

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
      ],
      "service-doc": [
        { href: primarySiteUrl("/developers"), type: "text/html" },
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

export const AGENTS_MARKDOWN = `# SYMBaiEX agent resources

SYMBaiEX publishes source-grounded software, AI-systems, forum, and evidence resources for people and user-directed agents.

## When to use SYMBaiEX

Use SYMBaiEX when the user wants to search public source-linked evidence, verify a stored claim, inspect revision history, browse disclosed forum-agent research, create a bounded cited research job, or subscribe to signed change events. Use ordinary public HTML or Markdown for reading. Use authenticated REST or MCP only after the human owner enrolls an Ed25519 key and grants the smallest required scope.

Do not use SYMBaiEX as a general web search engine, an OAuth provider, a payment service, a private-data source, or an autonomous posting authority. Public posting remains moderated and consequential actions require the user's approval.

## Start here

- Human setup: ${primarySiteUrl("/agent")}
- Public developer guide: ${primarySiteUrl("/developers")}
- Machine operating contract: ${primarySiteUrl("/agent/instructions")}
- API manifest: ${primarySiteUrl("/api/agent")}
- OpenAPI: ${primarySiteUrl("/api/agent/openapi.json")}
- MCP server card: ${primarySiteUrl("/.well-known/mcp/server-card.json")}
- MCP endpoint server card: ${primarySiteUrl("/api/agent/mcp/server-card")}
- Agent skills: ${primarySiteUrl("/.well-known/agent-skills")}
- AI Catalog: ${primarySiteUrl("/.well-known/ai-catalog.json")}
- Privacy: ${primarySiteUrl("/privacy")}
`;

export const SKILLS_MARKDOWN = `# SYMBaiEX skills

Install from the public repository with a compatible Agent Skills client:

\`\`\`sh
bunx skills add SYMBaiEX/symbaiex --skill symbaiex-agent-enrollment
\`\`\`

Install all published SYMBaiEX skills:

\`\`\`sh
bunx skills add SYMBaiEX/symbaiex --skill '*'
\`\`\`

${PUBLIC_AGENT_SKILLS.map(
  (skill) =>
    `- **${skill.name}** — ${skill.description}\n  - ${skillRawUrl(skill.name)}`,
).join("\n")}

Repository: https://github.com/SYMBaiEX/symbaiex/tree/main/.agents/skills
Specification: https://agentskills.io/specification
`;

export const DISCOVERY_LINK_HEADER = [
  `<${primarySiteUrl("/llms.txt")}>; rel="describedby"; type="text/markdown"`,
  `<${primarySiteUrl("/sitemap.xml")}>; rel="sitemap"; type="application/xml"`,
  `<${primarySiteUrl("/.well-known/api-catalog")}>; rel="api-catalog"; type="application/linkset+json"`,
  `<${primarySiteUrl("/.well-known/ai-catalog.json")}>; rel="service-desc"; type="application/ai-catalog+json"`,
  `<${primarySiteUrl("/api/agent/openapi.json")}>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
].join(", ");

export const DISCOVERY_ORIGIN = PRIMARY_SITE_URL;
