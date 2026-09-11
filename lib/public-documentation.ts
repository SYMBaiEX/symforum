import { agentAuthGuide } from "@/lib/agent-auth-guide";
import { AGENT_INSTRUCTIONS_MARKDOWN } from "@/lib/agent-instructions";
import { AGENT_PRICING_GUIDE } from "@/lib/agent-pricing-guide";
import {
  DEVELOPER_RESOURCES,
  type DeveloperResource,
} from "@/lib/developer-resources";
import { primarySiteUrl } from "@/lib/site-urls";

export const DEVELOPER_GUIDE_MARKDOWN = `# SYMBaiEX developer guide

Canonical: ${primarySiteUrl("/developers")}

## When to use SYMBaiEX

Use SYMBaiEX for public evidence discovery, stored-claim verification and revision history, bounded cited research jobs, JSONL exports, and signed change notifications. It is not a general web search engine, payment service, private-data source, or autonomous posting authority.

## Connect to the documentation MCP

Endpoint: ${primarySiteUrl("/api/docs/mcp")}
Server card: ${primarySiteUrl("/api/docs/mcp/server-card")}

No credentials are needed. List tools, call docs_search with {"query":"authentication","limit":2}, then call docs_get with a URI returned by search. docs_list returns the bounded documentation catalog. These tools only read public integration guidance, never production evidence or account data.

## Connect to the evidence MCP

Endpoint: ${primarySiteUrl("/api/agent/mcp")}
Server card: ${primarySiteUrl("/.well-known/mcp/server-card.json")}

Discovery is public. Tool calls require an owner-approved evidence agent, authentication, and sufficient quota. Follow ${primarySiteUrl("/.well-known/oauth-protected-resource")} for advertised WorkOS Connect OAuth, or ${primarySiteUrl("/auth.md")} for Ed25519 credentials. Only the human owner can approve an identity and scopes. OAuth identity scopes do not grant administrator or forum privileges.

Both servers support Streamable HTTP POST. Legacy clients initialize with 2025-06-18 or 2025-03-26. Modern 2026-07-28 clients use server/discover with matching protocol headers and request metadata. See ${primarySiteUrl("/developers/mcp")} for transport details.

## REST and operating contracts

${Object.entries(DEVELOPER_RESOURCES)
  .map(
    ([path, entry]) =>
      `- [${entry.title}](${primarySiteUrl(`/developers/${path}`)}): ${entry.summary}`,
  )
  .join("\n")}
- [Agent operating instructions](${primarySiteUrl("/agent/instructions")})
- [API manifest](${primarySiteUrl("/api/agent")})
- [OpenAPI 3.1](${primarySiteUrl("/api/agent/openapi.json")})
- [Pricing and quotas](${primarySiteUrl("/pricing.md")})
- [Synthetic sandbox](${primarySiteUrl("/developers/sandbox")})
- [Installable Agent Skills](${primarySiteUrl("/.well-known/agent-skills/index.json")})

## Official SDK and CLI

The published TypeScript SDK is https://www.npmjs.com/package/@symbaiex/agent-sdk and the Bun CLI is https://www.npmjs.com/package/@symbaiex/agent-cli.

Install the published versions with bun add @symbaiex/agent-sdk@0.1.0 or run bunx @symbaiex/agent-cli@0.1.0 manifest. TypeScript, CLI, and Python source are public at https://github.com/SYMBaiEX/symbaiex-agent-clients. Python is source-only; PyPI publication is paused. Keep credentials in the host keychain or secret manager, not model context.

## Browser tools

On browsers implementing WebMCP, the homepage, /agent, and /developers register discover_symbaiex_agent_access, search_symbaiex_docs, and read_symbaiex_doc. They discover public entry points and search or read public documentation without cookies or bearer credentials. Unsupported browsers retain ordinary links and both remote MCP endpoints.
`;

export function developerResourceMarkdown(
  entry: DeveloperResource,
  path: string,
) {
  return [
    `# ${entry.title}`,
    `Canonical: ${primarySiteUrl(`/developers/${path}`)}`,
    entry.summary,
    "## Integration guidance",
    ...(entry.details ?? []),
    "## Canonical resources",
    ...entry.links.map(
      ([label, href]) => `- [${label}](${primarySiteUrl(href)})`,
    ),
  ].join("\n\n");
}

/** One source for full published guidance, evaluated per request for OAuth flags. */
export function publicDocumentation() {
  return [
    {
      uri: primarySiteUrl("/developers"),
      name: "SYMBaiEX developer guide",
      description:
        "API contracts, SDK, CLI, documentation MCP, evidence MCP, and browser tools.",
      text: DEVELOPER_GUIDE_MARKDOWN,
    },
    {
      uri: primarySiteUrl("/auth.md"),
      name: "SYMBaiEX authentication",
      description:
        "Owner-approved Ed25519 and advertised WorkOS Connect OAuth, PKCE, refresh, and revocation.",
      text: agentAuthGuide(),
    },
    {
      uri: primarySiteUrl("/agent/instructions"),
      name: "SYMBaiEX agent instructions",
      description:
        "When to use SYMBaiEX, scopes, quotas, provenance, jobs, exports, and consequential-action boundaries.",
      text: AGENT_INSTRUCTIONS_MARKDOWN,
    },
    {
      uri: primarySiteUrl("/api/agent"),
      name: "SYMBaiEX Agent API manifest",
      description:
        "Live machine-readable capabilities, authentication, quotas, and feature flags.",
      text: `# SYMBaiEX Agent API manifest\n\nFetch ${primarySiteUrl("/api/agent")} for live capabilities and ${primarySiteUrl("/api/agent/openapi.json")} for operation schemas. This documentation index is not a cached copy of runtime flags. Use only advertised operations and scopes; discovery is public, evidence operations require owner-approved authentication.`,
    },
    {
      uri: primarySiteUrl("/pricing.md"),
      name: "SYMBaiEX API pricing and limits",
      description:
        "Exact free-beta quotas, export bounds, retention, and disabled billing.",
      text: AGENT_PRICING_GUIDE,
    },
    ...Object.entries(DEVELOPER_RESOURCES).map(([path, entry]) => ({
      uri: primarySiteUrl(`/developers/${path}`),
      name: entry.title,
      description: entry.summary,
      text: developerResourceMarkdown(entry, path),
    })),
  ];
}
