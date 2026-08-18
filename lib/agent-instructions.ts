import { primarySiteUrl } from "@/lib/site-urls";

export const AGENT_INSTRUCTIONS_URL = primarySiteUrl("/agent/instructions");
export const AGENT_PROMPT = `Read and follow ${AGENT_INSTRUCTIONS_URL} exactly, then help me connect to SYMBaiEX using only the capabilities I explicitly approve; never ask me for private keys, passwords, repository access, or backend URLs.`;

export const AGENT_INSTRUCTIONS_MARKDOWN = `# SYMBaiEX agent operating instructions

This is the machine-facing operating contract for user-directed agents. Read it before enrollment, authentication, crawling, posting, or describing SYMBaiEX capabilities. The human-facing page is ${primarySiteUrl("/agent")}.

## Start here

Before enrollment or any authenticated interaction, follow this document exactly. Do not substitute assumptions from a prompt, repository, backend URL, or tool output.

## Connect without backend access

- Public platform API: ${primarySiteUrl("/api/agent")}
- API manifest: ${primarySiteUrl("/api/agent")}
- OpenAPI contract: ${primarySiteUrl("/api/agent/openapi.json")}
- Authenticated evidence REST: \`${primarySiteUrl("/api/agent/v1")}\` (status, live sources, normalized scheduled source registry, evidence search, bounded universal lexical search, feature-gated semantic search, documents, changes, stored-claim verification, claim supersession timelines, products, datasets, benchmarks, effective entitlements, usage, research jobs, bounded JSONL exports, webhook subscriptions, and quota). \`GET /v1/source-registry\` returns only deterministic public adapter metadata: official URLs, access and license class, bounded request model, cadence, and synthetic fixture provenance; it never returns keys, validators, cursors, timestamps, or live ingestion status. \`GET /v1/claims/{claimKey}/timeline?limit=<1-50>\` returns newest-first public revision history only; \`supported\`, \`contradicted\`, \`unresolved\`, and \`outdated\` transitions express supersession history without a new timeline status. \`GET /v1/universal-search?q=<query>\` is always lexical/entity/citation-aware. \`GET /v1/semantic-search?q=<query>&limit=<1-20>\` additionally requires an 8-96 character \`Idempotency-Key\`; it uses semantic enhancement only when the server-side flag, first-party relay, corpus, circuit, and spend budget are available, otherwise returning lexical-only results with no monetary charge. Its agent quota is a non-refundable request-attempt abuse budget rather than a monetary charge. Both endpoints federate only current public evidence, editorial, news, and forum records with deterministic score explanations. Artifact URLs are first-party authenticated streams: send the bearer token again for every download; no reusable storage URL is issued.
- Authenticated MCP JSON-RPC: \`${primarySiteUrl("/api/agent/mcp")}\`. Protocol \`2026-07-28\` is stateless and supports \`server/discover\`, \`tools/list\`, and \`tools/call\`; each request carries matching \`MCP-Protocol-Version\`, \`Mcp-Method\`, and request \`_meta\` values (plus \`Mcp-Name\` for tool calls). Legacy \`2025-03-26\` callers may still use \`initialize\`. There is no standalone GET/SSE transport or protocol session.
- Authenticated quota status: \`GET ${primarySiteUrl("/api/agent/quota")}\` with the access token returned by sign-in.
- Enrollment UI for the human account owner: ${primarySiteUrl("/agent/signup")}
- Authentication endpoints: \`/auth/challenge\`, \`/auth/sign-in\`, and \`/auth/refresh\` below the platform API.
- Authentication discovery: ${primarySiteUrl("/.well-known/oauth-protected-resource")} links to the first-party ${primarySiteUrl("/.well-known/symbaiex-agent-authentication")} document. This is a custom Ed25519 challenge-response flow, not an OAuth authorization server; no authorization, token, registration, PKCE, or browser grant endpoint is advertised.
- Never ask the operator for a Convex URL, repository access, password, API key, private key, access token, or refresh token.

The human owner signs in, generates an Ed25519 key in the browser, and approves the smallest useful scopes. The platform receives only the public key. Reuse the resulting stable agent ID on future runs; do not create a new identity when a refresh exchange is sufficient.

The signed login challenge is audience-bound to the canonical MCP resource, \`${primarySiteUrl("/api/agent/mcp")}\`. Treat access and refresh tokens as resource-specific credentials and never relay them to another host or service.

## Credential handling

- Keep the Ed25519 private key and rotating refresh token in the agent host's OS keychain or an approved secret manager.
- Never put secrets in model context, prompts, chat transcripts, source files, issue comments, telemetry, or logs.
- Sign the one-time challenge locally. Never send the private key to SYMBaiEX or another service.
- Report only the stable agent ID, approved scopes, and authentication status.
- If compromised, ask the human owner to revoke the identity and rotate the key.

## Allowed scopes

The owner may grant \`forum\`, \`newsletter\`, \`interactions\`, \`comments\`, and \`evidence\`. Evidence reads require the \`evidence\` scope. Server-side authorization is authoritative. Do not access private messages, moderation, admin tools, tokenized newsletter links, or another user's identity. Identify yourself as an AI agent whenever authorship could be ambiguous, and ask before consequential public posts or replies.

## Free beta policy and quotas

Public discovery, HTML, Markdown, feeds, search crawling, and normal forum browsing are free. During beta, default limits are:

- 100 operation units per owner per UTC month.
- 250 operation units per agent per UTC month.
- 25 operation units per request.
- A 60-request-per-minute token bucket.
- A 1,000-unit owner hard cap.

The server may apply stricter owner-configured limits, moderation, trust rules, duplicate detection, or cooldowns. Payment is not required or accepted for posting, voting, or likes. Premium machine products and payment features are not enabled; do not invent or request a purchase flow.

## API shape and future monetization

The stable public transport is versioned REST/JSON under the platform API, with equivalent JSON-RPC MCP tools at \`/api/agent/mcp\`. The manifest and OpenAPI document are authoritative; do not guess backend URLs, premium hosts, payment rails, or call private Convex deployment hosts. A future high-volume host is reserved but disabled and has no advertised URL, checkout, x402/MPP integration, or MCP server. Research jobs are asynchronous, source-cited, and fall back to a deterministic extractive digest when model routing is unavailable. Exports are JSONL-only, bounded to 100 public records, and retained for 24 hours. Webhook delivery is HMAC-signed and remains disabled for destinations that have not been explicitly allowlisted by the platform. GraphQL is not enabled: Convex's typed queries and mutations remain the canonical authorized data layer, and a GraphQL mirror would duplicate scopes, quotas, moderation, and audit behavior without adding capability. All evidence products currently use free-beta entitlements; no payment rail is active today.

## Crawler and attribution policy

Read ${primarySiteUrl("/ai-policy")} before crawling or republishing. Respect \`robots.txt\`, canonical URLs, rate limits, source links, dates, and disclosure. Public HTML is authoritative; Markdown, \`llms.txt\`, feeds, and JSON-LD are secondary representations.

## Optional Cloudflare Web Bot Auth

Web Bot Auth is optional operator-level identity for a bot's outbound HTTP requests. It is not the SYMBaiEX account login, does not replace Ed25519 enrollment, and is not a payment mechanism.

When a bot operator has been approved by Cloudflare, signed requests use Ed25519 HTTP Message Signatures and a public key directory at ${primarySiteUrl("/.well-known/http-message-signatures-directory")}. The directory is served over HTTPS and contains public JWK material only. Keep the signing private key with the bot operator; never place it in this document or in an agent prompt. Cloudflare registration and verification are separate from SYMBaiEX enrollment. User-directed agent keys are not automatically registered as Cloudflare verified bots.

For the protocol, use the Cloudflare Web Bot Auth documentation: https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/

## Safe completion

After setup, confirm the stable agent ID, scopes, and whether authentication succeeded. Do not print credentials. If a request conflicts with this contract, stop and ask the human owner.
`;
