import { INSTALLATION_NAMESPACE } from "./site-urls";
import { AI_CATALOG } from "./agent-discovery";

// ARD v0.91 keeps existing entry identifiers; examples describe actual supported jobs.
const queries: Record<
  string,
  readonly [string, string]
> = {
  [`urn:air:${INSTALLATION_NAMESPACE}:a2a:documentation`]: [
    "Find SYMBaiEX integration guidance through an A2A agent",
    "Look up the public SYMBaiEX authentication instructions",
  ],
  [`urn:air:${INSTALLATION_NAMESPACE}:mcp:evidence`]: [
    "Search SYMBaiEX public evidence with my approved agent",
    "Verify a stored research claim against its citations",
  ],
  [`urn:air:${INSTALLATION_NAMESPACE}:api:agent-v1`]: [
    "Integrate SYMBaiEX evidence search through REST",
    "Find the request schema for a bounded research export",
  ],
  [`urn:air:${INSTALLATION_NAMESPACE}:api:sandbox-v1`]: [
    "Test evidence response parsing without production credentials",
    "Explore synthetic SYMBaiEX search results safely",
  ],
  [`urn:air:${INSTALLATION_NAMESPACE}:api:sandbox-openapi-v1`]: [
    "Find the OpenAPI contract for the synthetic sandbox",
    "Validate a client against read-only sandbox schemas",
  ],
  [`urn:air:${INSTALLATION_NAMESPACE}:events:agent-v1`]: [
    "Verify signatures on SYMBaiEX evidence webhooks",
    "Find the event schema for completed research jobs",
  ],
  [`urn:air:${INSTALLATION_NAMESPACE}:skills:agent-api`]: [
    "Install SYMBaiEX agent enrollment instructions",
    "Find an operating skill for cited research jobs",
  ],
  [`urn:air:${INSTALLATION_NAMESPACE}:plugin:agent-api`]: [
    "Install the SYMBaiEX skills and MCP plugin bundle",
    "Find the public SYMBaiEX Agent Plugins manifest",
  ],
  [`urn:air:${INSTALLATION_NAMESPACE}:mcp:documentation`]: [
    "Search SYMBaiEX developer documentation over MCP",
    "Read the complete SYMBaiEX authentication guide without credentials",
  ],
};

export const ARD_CATALOG = {
  // Preserve the AI Catalog 1.0 envelope for older consumers. ARD v0.91
  // explicitly ignores additional top-level fields and uses the entries below.
  ...AI_CATALOG,
  entries: AI_CATALOG.entries.map((entry) => ({
    ...entry,
    "@context": "https://agenticresourcediscovery.org/context/v1",
    representativeQueries: queries[entry.identifier],
  })),
};
