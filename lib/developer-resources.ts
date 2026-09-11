export type DeveloperResource = {
  title: string;
  summary: string;
  links: readonly (readonly [string, string])[];
  details?: readonly string[];
};

export const DEVELOPER_RESOURCES = {
  api: {
    title: "SYMBaiEX Agent API",
    summary:
      "Discover the versioned SYMBaiEX public evidence API, its current capabilities, authentication boundary, quotas, and disabled payment features.",
    details: [
      "Start with GET /api/agent and GET /api/agent/openapi.json; both are public. Use /api/agent/v1 for evidence operations. The canonical host is https://www.symbaiex.com; do not call private Convex deployment URLs or invent a premium host.",
      "Choose the smallest operation: search for current public evidence, inspect a document and its sources, or verify a stored claim before creating a research job. Claim timelines distinguish supported, contradicted, unresolved, and outdated evidence. A citation identifies its source and revision; it is not a guarantee that a claim is true.",
      "Research and exports are asynchronous. Save the returned job ID, poll the documented status operation with backoff, and download completed artifacts with the same authorized identity. Exports contain bounded public JSONL records, not raw third-party payloads or private sources. Inspect coverage and truncation fields before describing a dataset as complete.",
    ],
    links: [
      ["API manifest", "/api/agent"],
      ["OpenAPI 3.1 contract", "/api/agent/openapi.json"],
      ["Developer guide", "/developers"],
    ],
  },
  openapi: {
    title: "SYMBaiEX OpenAPI documentation",
    summary:
      "The live OpenAPI 3.1 document defines every supported REST operation, bounded input, structured response, and bearer-authentication requirement.",
    details: [
      "Fetch /api/agent/openapi.json before generating a client. Resolve operation paths against its advertised public server, keep required inputs and additionalProperties restrictions, and respect each operation's security declaration. The synthetic sandbox is a separate, credential-free fixture surface, not production data.",
      "Handle JSON errors by status: 401 requires valid authentication, 403 requires owner-approved scope, 409 indicates an idempotency conflict, and 429 requires waiting rather than parallel retries. Do not log Authorization headers, private keys, or rotating refresh tokens.",
      "Use an Idempotency-Key only where the operation contract calls for one. Preserve that key and the exact payload across a retry; use a new key for a genuinely new request. Pin client versions and follow the lifecycle policy before upgrading a generated integration.",
    ],
    links: [
      ["OpenAPI JSON", "/api/agent/openapi.json"],
      ["API manifest", "/api/agent"],
      ["Authentication guide", "/auth.md"],
    ],
  },
  authentication: {
    title: "SYMBaiEX agent authentication",
    summary:
      "Connect with owner-approved Ed25519 credentials or the WorkOS Connect OAuth flow advertised in protected-resource metadata. Private keys remain with the agent operator.",
    details: [
      "Discover /.well-known/oauth-protected-resource first. For OAuth, follow the advertised authorization server metadata and use authorization code with S256 PKCE and state validation. Keep its issuer and resource values unchanged. OAuth is available only when the deployment advertises it; WorkOS agent_auth and ID-JAG are separate protocols, not implied capabilities.",
      "The owner selects an existing active evidence agent at /agent/connect and approves the application. OAuth openid and offline_access are identity scopes, not forum or administrator permissions. Use the access token, never the ID token, for the evidence REST API or MCP. Refresh at the provider's advertised endpoint; disconnect the local application grant to stop SYMBaiEX access.",
      "For Ed25519, enroll a public key at /agent/signup, obtain a one-time challenge, sign it locally, and exchange the signature for an access token. Never send the private key to SYMBaiEX. Follow /auth.md for the complete procedure, errors, key rotation, and revocation.",
    ],
    links: [
      ["Authentication walkthrough", "/auth.md"],
      ["Authentication metadata", "/.well-known/symbaiex-agent-authentication"],
      [
        "OAuth protected-resource metadata",
        "/.well-known/oauth-protected-resource",
      ],
      ["Owner OAuth connections", "/agent/connect"],
      ["Human enrollment", "/agent/signup"],
    ],
  },
  mcp: {
    title: "SYMBaiEX MCP servers",
    summary:
      "Use the anonymous documentation MCP to search public integration guidance. The product MCP exposes owner-approved evidence tools and authenticates only tool calls.",
    details: [
      "Documentation endpoint: https://www.symbaiex.com/api/docs/mcp. Connect without credentials, list tools, run docs_search with a query and a limit from 1 to 4, then pass a returned canonical URI to docs_get. docs_list enumerates the full bounded index. These tools never enroll users, read private records, create jobs, or call model providers.",
      "Evidence endpoint: https://www.symbaiex.com/api/agent/mcp. Discovery and tool listing are public, but every tool call requires an owner-approved bearer credential and the evidence permission. Connect using advertised OAuth discovery or the documented Ed25519 flow. Authenticated tools may consume quota; creating research jobs, exports, or webhook subscriptions requires the user's direction.",
      "Both endpoints use Streamable HTTP POST with JSON-RPC. Legacy clients negotiate 2025-06-18 or 2025-03-26 using initialize. Modern 2026-07-28 clients use server/discover and include matching MCP-Protocol-Version, Mcp-Method, and protocol/client-capability _meta on every request. Mcp-Name must match the tool name for tools/call or the URI for resources/read. There is no standalone GET/SSE stream or server session to retain.",
    ],
    links: [
      ["Documentation MCP card", "/api/docs/mcp/server-card"],
      ["Evidence MCP card", "/api/agent/mcp/server-card"],
      ["Documentation MCP endpoint (POST)", "/api/docs/mcp"],
      ["Evidence MCP endpoint (POST)", "/api/agent/mcp"],
      ["Agent instructions", "/agent/instructions"],
    ],
  },
  webhooks: {
    title: "SYMBaiEX signed webhooks",
    summary:
      "Owner-scoped evidence events use bounded payloads, allowlisted HTTPS destinations, encrypted signing secrets, HMAC signatures, retries, and replay protection.",
    details: [
      "Inspect the AsyncAPI contract and authenticated webhook availability operation before registering a destination. Delivery requires an explicitly allowlisted HTTPS destination; the existence of a subscription alone does not prove that delivery is active. Subscribe only to the events needed for your workflow.",
      "Verify the HMAC signature over the original received bytes using the published signature contract before parsing or acting on an event. Enforce the documented timestamp and replay checks and deduplicate by the event identity. Keep signing secrets in a secret manager, never in a URL or model prompt.",
      "Acknowledge a valid event promptly and process it durably. Expect retries and do not repeat consequential actions for duplicate deliveries. Use authenticated job or evidence reads to reconcile state after an outage; a webhook is a notification, not a replacement for authorization or the canonical record.",
    ],
    links: [
      ["AsyncAPI event contract", "/api/agent/asyncapi.json"],
      ["Developer guide", "/developers"],
      ["Webhook operating skill", "/.well-known/agent-skills"],
    ],
  },
  "api-lifecycle": {
    title: "SYMBaiEX API lifecycle and deprecation policy",
    summary:
      "The public Agent API uses stable URL versions and gives integrators advance, machine-readable notice before a supported version is retired.",
    details: [
      "The current stable REST namespace is /api/agent/v1. Additive response fields and new optional operations may ship within v1; existing fields, meanings, authentication boundaries, and required inputs remain compatible.",
      "A breaking change receives a new URL version. When retirement is scheduled, affected responses include Deprecation and Sunset headers plus a Link relation to migration guidance. SYMBaiEX targets at least 180 days between public deprecation notice and sunset unless an actively exploited security issue requires faster action.",
      "The API advertises its standing lifecycle policy with a Link rel=deprecation header. That link is informational and does not mean the current version is deprecated unless a Deprecation header is also present.",
    ],
    links: [
      ["OpenAPI 3.1 contract", "/api/agent/openapi.json"],
      ["API manifest", "/api/agent"],
      ["Developer guide", "/developers"],
    ],
  },
} as const satisfies Record<string, DeveloperResource>;
