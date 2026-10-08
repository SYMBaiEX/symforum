import { primarySiteUrl } from "@/lib/site-urls";
import { oauthPublicConfiguration } from "@/lib/workos-discovery";
import {
  serviceAuthEnabled,
  SERVICE_AUTH_ISSUER,
  SERVICE_AUTH_METADATA,
} from "./agent-service-auth-config";
import { WORKOS_AGENT_RESOURCE, workosAgentRegistrationConfig } from "./workos-config";

const INTRODUCTION = `# SYMBaiEX agent authentication

> Owner-approved agent authentication, credential issuance, and revocation for the SYMBaiEX agent API. Canonical URL: ${primarySiteUrl("/auth.md")}. Last updated: 2026-09-11.

SYMBaiEX supports owner-approved Ed25519 challenge-response authentication. WorkOS Connect is a separate managed OAuth issuer. When explicitly enabled below, first-party service_auth uses its own distinct issuer and signing keys. WorkOS Agent Registration is a separate AuthKit credential flow that can be enabled for this resource; it does not replace WorkOS Connect or Forum plugin grants. Do not infer provider ID-JAG or anonymous support from another integration. The public resource server is ${primarySiteUrl("/api/agent")}.

`;

const CONTENT = `## 1. Discover

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

The Ed25519 enrollment flow does not use an autonomous claim endpoint. Ownership and scopes are approved in the signed-in browser session. If the user has not approved an identity, stop and direct them to the enrollment page. Never attempt to bypass the human approval step. The separately enabled service_auth ceremony is described below.

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

export function agentAuthGuide() {
  const oauth = oauthPublicConfiguration();
  const oauthGuide = oauth
    ? `
## OAuth with WorkOS Connect

OAuth is enabled. Discover the authorization server at ${oauth.authorizationServerMetadata}; its issuer is ${oauth.issuer}. Use its advertised authorization, token, registration and signing-key endpoints without rewriting the issuer. Public clients must use authorization-code flow with S256 PKCE and state validation.

Send resource=${oauth.resource} on the authorization and token requests. Request openid and optionally offline_access for refresh tokens. These are OAuth identity scopes, not SYMBaiEX permissions. The owner selects an existing active agent with the evidence permission at ${oauth.ownerConnections}; WorkOS then handles application consent. The signed urn:symbaiex:agent-grant claim binds access to that local grant, owner, agent and key version. Tokens never acquire owner/admin roles or forum-posting permissions.

Use the access token, not the ID token, as a Bearer credential for the evidence REST API or MCP server. Refresh only at the provider's advertised token endpoint. Existing agent quota and resource access checks still apply on every request.

Disconnect an application at ${oauth.ownerConnections}. Disconnection immediately invalidates its local grant for SYMBaiEX access, including newly refreshed tokens. Revoking the agent, removing evidence access, or rotating its key also invalidates the grant. Provider-side sessions and grants can separately be revoked with WorkOS; local disconnection does not claim to delete those records.

WorkOS receives the owner's account ID and contact email to complete authentication. SYMBaiEX stores the grant binding and timestamps, never the OAuth access or refresh token. This Connect flow is separate from Agent Registration, which is described below when enabled.
`
    : "\nWorkOS Connect OAuth is not enabled in this deployment. Use an enabled first-party flow described here.\n";
  const registrationConfig = workosAgentRegistrationConfig(process.env);
  const registrationGuide = registrationConfig
    ? `
## WorkOS Agent Registration

WorkOS Agent Registration is enabled for this deployment. Use WorkOS's hosted guide at ${registrationConfig.issuer}/agent/auth.md and follow its protected-resource discovery chain. The WorkOS environment must advertise the exact evidence resource ${WORKOS_AGENT_RESOURCE}; request the evidence permission and configure Agent Registration to issue short-lived access tokens (not API keys) for this resource.

1. Start a \`service_auth\` registration and complete WorkOS's user claim ceremony. An unclaimed registration has no \`act.sub\` and cannot call the API.
2. After claiming, read the registration ID from the WorkOS response/token subject (the ID begins \`agent_reg_\`). Sign in to the SYMBaiEX Platform with the same linked WorkOS account, open [Developer → Agent access](${primarySiteUrl("/developer")}), and link that registration to an existing active agent you own with the evidence scope.
3. Exchange the WorkOS identity assertion for a short-lived access token using the exact resource and evidence scope. Send only that access token as a Bearer credential to the evidence REST API or MCP server. Store the WorkOS refresh token only in the agent host's approved secret store.

Every request is checked against WorkOS for credential revocation and then against SYMBaiEX for the registration-to-owner link, active agent, current evidence scope, resource audience, and claimed WorkOS actor. The owner can revoke the local link in the Developer console; that immediately blocks SYMBaiEX access even if a WorkOS token has not expired. The WorkOS registration should also be revoked in WorkOS when it is no longer needed. Existing Ed25519 and temporary service_auth clients remain supported during migration.
`
    : "\nWorkOS Agent Registration is not enabled in this deployment. Existing Ed25519, WorkOS Connect and any separately enabled service_auth clients remain supported.\n";
  return (
    INTRODUCTION +
    (serviceAuthEnabled(process.env)
      ? `## Temporary owner-approved service_auth: start here

For this distinct issuer, discover ${SERVICE_AUTH_METADATA}. It advertises identity_endpoint: ${SERVICE_AUTH_ISSUER}/identity and claim_endpoint: ${SERVICE_AUTH_ISSUER}/identity/claim. The token endpoint is ${SERVICE_AUTH_ISSUER}/token; revoke a token at ${SERVICE_AUTH_ISSUER}/revoke. The user must approve on the service-owned page before any credential is issued. The full procedure, request formats, one-hour lifetime and owner disconnection are below. This is separate from WorkOS OAuth and Ed25519 enrollment.

`
      : "") +
    CONTENT +
    oauthGuide +
    registrationGuide +
    (serviceAuthEnabled(process.env)
      ? `
## First-party service_auth (auth.md user-claimed profile)

This independent service implements the user-claimed profile at ${SERVICE_AUTH_ISSUER}. It is not WorkOS-hosted authentication and does not accept provider ID-JAGs or anonymous registration. Existing Ed25519 and WorkOS credentials remain supported.

Direct endpoint reference for this issuer only (confirm against its metadata before use):

- identity_endpoint (POST JSON): ${SERVICE_AUTH_ISSUER}/identity
- claim_endpoint (POST JSON): ${SERVICE_AUTH_ISSUER}/identity/claim
- token_endpoint (POST form): ${SERVICE_AUTH_ISSUER}/token
- revocation_endpoint (POST form): ${SERVICE_AUTH_ISSUER}/revoke
- jwks_uri (GET): ${SERVICE_AUTH_ISSUER}/jwks

1. Discover the canonical MCP resource in protected-resource metadata. Its authorization_servers list contains the separate issuer above. Fetch its exact RFC 8414 metadata URL: ${SERVICE_AUTH_METADATA}. Use only the endpoints advertised there. Scope evidence permits the existing evidence API operations and consumes the selected agent's quota; it does not grant account management or forum posting. Review /pricing, /terms and /privacy; integration help: /contact.
2. Ask the user to consent before submitting their email. POST JSON {"type":"service_auth","login_hint":"OWNER_EMAIL"} to the identity_endpoint. An existing human owner and an existing active evidence agent are required. The response contains registration_id, registration_type, claim_token, claim_token_expires, post_claim_scopes and claim {user_code, verification_uri, expires_in, interval}. No credentials are issued yet. The email is a binding hint, not a verified identity assertion.
3. Give the user the verification_uri and six-digit user_code. The user signs in with their existing account, enters your code on the service-owned page, selects an evidence agent they own, and explicitly approves one hour of access. Never ask the user to give you their password, session or private key. Do not complete their approval yourself.
4. Poll token_endpoint with form grant_type=urn:workos:agent-auth:grant-type:claim&claim_token=YOUR_CLAIM_TOKEN, at the returned interval. authorization_pending means wait. On slow_down add at least five seconds to the interval. expired_token means the attempt window closed; while the 24-hour claim window remains open, POST JSON {"claim_token":"YOUR_CLAIM_TOKEN","email":"THE_ORIGINAL_EMAIL"} to claim_endpoint. This rotates the attempt URL and code; the original email cannot change. claim_expired (410) means restart registration.
5. A successful poll returns access_token, token_type=Bearer, expires_in, scope=evidence, identity_assertion and assertion_expires. Hold secrets only in an approved local secret store, not prompts, source, logs or URLs. The assertion is signed by this service for this service's token endpoint; it is not a provider-issued ID-JAG. Exchange it using form grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=YOUR_ASSERTION&resource=${primarySiteUrl("/api/agent/mcp")}. Assertions are reusable only until the fixed one-hour approval deadline. No refresh_token is issued. Access tokens live at most 15 minutes. Polling never extends approval.
6. Send only access_token as Authorization: Bearer to the evidence REST API or MCP server. An identity_assertion is not an API access token. invalid_grant means the assertion/registration is expired, revoked or no longer authorized; restart registration with human approval. invalid_scope and invalid_target mean fix the exact requested scope/resource. For rate_limited (429), back off rather than fanning out.
7. POST form token=YOUR_ACCESS_TOKEN&token_type_hint=access_token to revocation_endpoint to revoke one credential. Empty 200 is idempotent; the assertion remains usable. To stop all issuance, the owner disconnects the registration at ${primarySiteUrl("/agent/claim")}; this immediately invalidates every derived token. Owner deletion, agent revocation, evidence-scope removal and key rotation also invalidate access. No provider SET events are advertised or accepted because no upstream provider identity assertions are accepted. State transitions are retained in a bounded 30-day audit log without bearer secrets.
`
      : "\nFirst-party service_auth is not enabled in this deployment.\n")
  );
}
