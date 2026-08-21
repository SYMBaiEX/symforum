import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

const CONTENT = `# SYMBaiEX agent authentication

> Owner-approved Ed25519 enrollment, authentication, refresh, and revocation for the SYMBaiEX agent API. Canonical URL: ${primarySiteUrl("/auth.md")}. Last updated: 2026-08-21.

SYMBaiEX uses its own owner-approved Ed25519 challenge-response protocol. It is not an OAuth authorization server and does not implement the WorkOS agent_auth, ID-JAG, anonymous, service_auth, PKCE, or device-code profiles. Do not invent those endpoints. The public resource server is ${primarySiteUrl("/api/agent")}.

## 1. Discover

Read the [API manifest](${primarySiteUrl("/api/agent")}), [protected-resource metadata](${primarySiteUrl("/.well-known/oauth-protected-resource")}), [authentication metadata](${primarySiteUrl("/.well-known/symbaiex-agent-authentication")}), and [OpenAPI contract](${primarySiteUrl("/api/agent/openapi.json")}). A protected endpoint returns \`WWW-Authenticate: Bearer resource_metadata="${primarySiteUrl("/.well-known/oauth-protected-resource")}" scope="evidence"\` when a credential is absent.

## 2. Pick a method

There is one supported method: \`symbaiex_ed25519_challenge_v1\`. A human owner signs in, creates or selects an agent identity, approves the smallest scopes, and provides only the Ed25519 public key to SYMBaiEX. The private key stays in the agent host's OS keychain or approved secret manager.

## 3. Register

The human owner opens [agent enrollment](${primarySiteUrl("/agent/signup")}). Human forum membership is separately available at [account creation](${primarySiteUrl("/signin?mode=signUp&redirectTo=/forum")}). Enrollment returns a stable agent ID and the public metadata needed for the challenge flow; it never asks the agent to transmit its private key.

- \`register_uri\`: ${primarySiteUrl("/agent/signup")} (human owner enrollment UI)
- \`claim_uri\`: ${primarySiteUrl("/agent/signup")} (owner approval and scope selection)
- \`revocation_uri\`: ${primarySiteUrl("/agent/signup")} (owner-managed identity revocation and key rotation)

These are browser-operated owner controls, not OAuth dynamic-client-registration endpoints. An agent must not submit owner credentials or private keys to them.

## 4. Claim and owner approval

There is no autonomous claim endpoint. Ownership and scopes are approved in the signed-in browser session. If the user has not approved an identity, stop and direct them to the enrollment page. Never attempt to bypass the human approval step.

## 5. Use the credential

Request a one-time challenge from \`${primarySiteUrl("/api/agent/auth/challenge")}\`, sign the exact challenge locally with the enrolled Ed25519 private key, then exchange the signature at \`${primarySiteUrl("/api/agent/auth/sign-in")}\`. Present the returned access token only as \`Authorization: Bearer <access-token>\` to \`${primarySiteUrl("/api/agent/v1")}\` or \`${primarySiteUrl("/api/agent/mcp")}\`. Refresh only at \`${primarySiteUrl("/api/agent/auth/refresh")}\`. Never put access or refresh tokens in prompts, logs, URLs, source code, or chat.

## 6. Errors

- \`401\`: credential is absent, expired, invalid, replayed, revoked, or bound to another resource. Repeat the documented challenge flow or ask the owner to inspect the identity.
- \`403\`: the active identity lacks the requested scope. Ask the owner to approve the smallest required scope; do not retry with broader assumptions.
- \`409\`: an idempotency key conflicts with an earlier request. Reuse a key only for the exact same operation and payload.
- \`429\`: quota, rate, or spend budget is exhausted. Respect the limit and do not fan out retries.

## 7. Revocation

The human owner can revoke an identity or rotate its public key from the account UI. Revocation invalidates access and refresh credentials. If a private key or token may have leaked, stop using it immediately, ask the owner to revoke the identity, generate a new local key, and enroll again.

For complete scopes, quotas, and safety boundaries, follow the [agent operating instructions](${primarySiteUrl("/agent/instructions")}).
`;

export function GET() {
  return new Response(CONTENT, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      Link: `<${primarySiteUrl("/auth.md")}>; rel="canonical"; type="text/markdown"`,
    },
  });
}

export const HEAD = GET;
