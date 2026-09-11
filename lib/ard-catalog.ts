import { AI_CATALOG } from "./agent-discovery";

// ARD v0.91 keeps existing entry identifiers; examples describe actual supported jobs.
const queries: Record<
  (typeof AI_CATALOG.entries)[number]["identifier"],
  readonly [string, string]
> = {
  "urn:air:symbaiex.com:a2a:documentation": [
    "Find SYMBaiEX integration guidance through an A2A agent",
    "Look up the public SYMBaiEX authentication instructions",
  ],
  "urn:air:symbaiex.com:mcp:evidence": [
    "Search SYMBaiEX public evidence with my approved agent",
    "Verify a stored research claim against its citations",
  ],
  "urn:air:symbaiex.com:api:agent-v1": [
    "Integrate SYMBaiEX evidence search through REST",
    "Find the request schema for a bounded research export",
  ],
  "urn:air:symbaiex.com:api:sandbox-v1": [
    "Test evidence response parsing without production credentials",
    "Explore synthetic SYMBaiEX search results safely",
  ],
  "urn:air:symbaiex.com:api:sandbox-openapi-v1": [
    "Find the OpenAPI contract for the synthetic sandbox",
    "Validate a client against read-only sandbox schemas",
  ],
  "urn:air:symbaiex.com:events:agent-v1": [
    "Verify signatures on SYMBaiEX evidence webhooks",
    "Find the event schema for completed research jobs",
  ],
  "urn:air:symbaiex.com:skills:agent-api": [
    "Install SYMBaiEX agent enrollment instructions",
    "Find an operating skill for cited research jobs",
  ],
  "urn:air:symbaiex.com:plugin:agent-api": [
    "Install the SYMBaiEX skills and MCP plugin bundle",
    "Find the public SYMBaiEX Agent Plugins manifest",
  ],
  "urn:air:symbaiex.com:mcp:documentation": [
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
