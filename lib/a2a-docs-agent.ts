import { primarySiteUrl } from "@/lib/site-urls";

export const A2A_PROTOCOL_VERSION = "1.0";

export const A2A_DOCS_AGENT_CARD = {
  name: "SYMBaiEX Documentation Agent",
  description:
    "Read-only lookup over curated public SYMBaiEX developer and agent documentation.",
  supportedInterfaces: [
    {
      url: primarySiteUrl("/api/a2a"),
      protocolBinding: "JSONRPC",
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
  ],
  provider: {
    organization: "SYMBaiEX",
    url: primarySiteUrl("/"),
  },
  iconUrl: primarySiteUrl("/favicon.svg"),
  version: "1.0.0",
  documentationUrl: primarySiteUrl("/developers"),
  capabilities: {
    streaming: false,
    pushNotifications: false,
    extendedAgentCard: false,
  },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "search-symbaiex-docs",
      name: "Search SYMBaiEX developer documentation",
      description:
        "Find canonical public guidance for agent enrollment, authentication, REST, MCP, quotas, research jobs, exports, and signed webhooks.",
      tags: ["SYMBaiEX", "developer documentation", "MCP", "API"],
      examples: [
        "How do I enroll an Ed25519 agent with SYMBaiEX?",
        "Where is the SYMBaiEX OpenAPI contract?",
      ],
      inputModes: ["text/plain"],
      outputModes: ["text/plain"],
    },
  ],
} as const;

const DOCS = [
  {
    title: "SYMBaiEX developer guide",
    url: primarySiteUrl("/developers"),
    terms: "developer docs api mcp quota research export webhook setup",
  },
  {
    title: "SYMBaiEX authentication guide",
    url: primarySiteUrl("/auth.md"),
    terms: "authentication auth ed25519 enroll enrollment challenge refresh revoke",
  },
  {
    title: "SYMBaiEX agent operating instructions",
    url: primarySiteUrl("/agent/instructions"),
    terms: "agent instructions scope evidence when use safety attribution",
  },
  {
    title: "SYMBaiEX Agent API manifest",
    url: primarySiteUrl("/api/agent"),
    terms: "api manifest openapi capabilities rest quota evidence",
  },
] as const;

export function answerA2aDocsQuery(query: string) {
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 2)
        .slice(0, 16),
    ),
  ];
  const ranked = DOCS.map((document) => ({
    document,
    score: terms.filter((term) =>
      `${document.title} ${document.terms}`.toLowerCase().includes(term),
    ).length,
  }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.title.localeCompare(right.document.title),
    );
  const results = (ranked.length > 0
    ? ranked
    : [{ document: DOCS[0], score: 1 }]
  ).slice(0, 4);
  return [
    "Canonical SYMBaiEX resources:",
    ...results.map(({ document }) => `- ${document.title}: ${document.url}`),
  ].join("\n");
}
