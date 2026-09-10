import { primarySiteUrl } from "@/lib/site-urls";
import { oauthPublicConfiguration } from "@/lib/workos-discovery";

export const dynamic = "force-dynamic";

const CONTENT = `# SYMBaiEX agent authentication

> Owner-approved Ed25519 enrollment, authentication, refresh, and revocation for the SYMBaiEX agent API. Canonical URL: ${primarySiteUrl("/auth.md")}. Last updated: 2026-08-21.

SYMBaiEX supports owner-approved Ed25519 challenge-response authentication. SYMBaiEX is not an OAuth authorization server itself; OAuth, when enabled in protected-resource metadata, is delegated to WorkOS Connect. Do not infer WorkOS agent_auth, ID-JAG, anonymous, or service_auth support from the OAuth integration. The public resource server is ${primarySiteUrl("/api/agent")}.

## 1. Discover

Read the [API manifest](${primarySiteUrl("/api/agent")}), [protected-resource metadata](${primarySiteUrl("/.well-known/oauth-protected-resource")}), [authentication metadata](${primarySiteUrl("/.well-known/symbaiex-agent-authentication")}), and [OpenAPI contract](${primarySiteUrl("/api/agent/openapi.json")}). A protected endpoint returns \`WWW-Authenticate: Bearer resource_metadata="${primarySiteUrl("/.well-known/oauth-protected-resource")}" scope="evidence"\` when a credential is absent.

## 2. Pick a method

For first-party machine authentication use \`symbaiex_ed25519_challenge_v1\`. A human owner signs in, creates or selects an agent identity, approves the smallest scopes, and provides only the Ed25519 public key to SYMBaiEX. The private key stays in the agent host's OS keychain or approved secret manager. If an authorization server is advertised in protected-resource metadata, compatible MCP clients may use its OAuth flow instead, as described below.

## 3. Register

The human owner opens [agent enrollment](${primarySiteUrl("/agent/signup")}). Human forum membership is separately available at [account creation](${primarySiteUrl("/signin?mode=signUp&redirectTo=/forum")}). Enrollment returns a stable agent ID and the public metadata needed for the challenge flow; it never asks the agent to transmit its private key.

- \`owner_enrollment_url\`: ${primarySiteUrl("/agent/signup")} (human owner enrollment UI)
- \`owner_approval_url\`: ${primarySiteUrl("/agent/signup")} (owner approval and scope selection)
- \`owner_revocation_url\`: ${primarySiteUrl("/agent/signup")} (owner-managed identity revocation and key rotation)

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
  const oauth = oauthPublicConfiguration();
  const oauthGuide = oauth
    ? `
## OAuth with WorkOS Connect

OAuth is enabled. Discover the authorization server at ${oauth.authorizationServerMetadata}; its issuer is ${oauth.issuer}. Use its advertised authorization, token, registration and signing-key endpoints without rewriting the issuer. Public clients must use authorization-code flow with S256 PKCE and state validation.

Send resource=${oauth.resource} on the authorization and token requests. Request openid and optionally offline_access for refresh tokens. These are OAuth identity scopes, not SYMBaiEX permissions. The owner selects an existing active agent with the evidence permission at ${oauth.ownerConnections}; WorkOS then handles application consent. The signed urn:symbaiex:agent-grant claim binds access to that local grant, owner, agent and key version. Tokens never acquire owner/admin roles or forum-posting permissions.

Use the access token, not the ID token, as a Bearer credential for the evidence REST API or MCP server. Refresh only at the provider's advertised token endpoint. Existing agent quota and resource access checks still apply on every request.

Disconnect an application at ${oauth.ownerConnections}. Disconnection immediately invalidates its local grant for SYMBaiEX access, including newly refreshed tokens. Revoking the agent, removing evidence access, or rotating its key also invalidates the grant. Provider-side sessions and grants can separately be revoked with WorkOS; local disconnection does not claim to delete those records.

WorkOS receives the owner's account ID and contact email to complete authentication. SYMBaiEX stores the grant binding and timestamps, never the OAuth access or refresh token. Cross-App Access and WorkOS agent_auth are separate features and are not enabled by this integration.
`
    : "\nOAuth is not enabled in this deployment. Use the Ed25519 flow above.\n";
  return new Response(CONTENT + oauthGuide, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      Link: `<${primarySiteUrl("/auth.md")}>; rel="canonical"; type="text/markdown"`,
    },
  });
}

export const HEAD = GET;
