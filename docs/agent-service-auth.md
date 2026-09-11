# First-party service_auth deployment and verification

This is an additive implementation of the [auth.md user-claimed profile](https://github.com/workos/auth.md/blob/main/agent-services/README.md), not a replacement for WorkOS Connect or Convex Auth. It is disabled by default. The user explicitly selected existing-human-owner approval and existing evidence agents; anonymous registration and provider identity assertions are not supported.

## Boundaries

- Issuer: `https://www.symbaiex.com/agent-auth`.
- RFC 8414 metadata: `https://www.symbaiex.com/.well-known/oauth-authorization-server/agent-auth`. An issuer-relative compatibility alias returns identical metadata.
- Canonical access-token audience: `https://www.symbaiex.com/api/agent/mcp`.
- Only `service_auth`, only `evidence`, no account/admin/forum permissions. No automatic account creation or email-based owner lookup.
- WorkOS remains `https://unique-evening-77.authkit.app`; never add local endpoints or agent-auth claims to its metadata.
- Registration is anonymous infrastructure state only. No credentials are issued until the existing human signs in, matches the original email, supplies the agent's code, selects their active evidence agent and explicitly approves.
- `contactEmail || email` is a binding hint, not a claim of verified mailbox possession. Assertions deliberately contain no `email_verified` claim. The signed-in first-party account plus its existing agent ownership authorizes access.
- Access tokens: RS256, `typ=at+jwt`, audience MCP, subject registration ID, explicit access-kind and token-record claims. Service assertions: RS256, `typ=oauth-id-jag+jwt`, audience local issuer, assertion-kind. They are not provider-issued ID-JAGs.
- A registration approval lasts one hour. Access tokens last at most 15 minutes and cannot outlive approval. An assertion can be re-exchanged until the original one-hour deadline; no refresh token and no rolling extension. Restart requires human approval.
- Token records permit immediate single-token revoke. Registration status, current owner, agent scopes/status and key version are revalidated on every protected request. Owner disconnect blocks every existing token and future exchange.
- Owner confirmation uses the normal authenticated Convex client mutation, not a cookie-authenticated public POST. Cross-origin sites do not possess that bearer session. The code and attempt token are revalidated transactionally on submit. The browser form is service-owned; agents must not operate it for the owner.
- Provider SET events are neither advertised nor accepted. There is no trusted upstream provider identity to revoke. Internal audit events are not equivalent to upstream Security Event Tokens.

## Configuration and activation

Production target is **strong-bee-384**. Local `.env` defaults to development: never infer the target from it. The implementation lane does not execute these deployment commands; the release owner must first integrate the commit and confirm this production target.

1. Run local key generation into a new absolute directory outside the repository:

   `bun scripts/setup-agent-service-auth.mjs /absolute/new/private-directory`

   This creates a mode-0700 directory containing three mode-0600 files. It refuses overwrite and never prints values. Store the directory in the approved secret manager; never commit it, paste it into chat, or run `cat` on it in a logged tool.

2. Install the three file values into Convex without values in command history:

   ```sh
   bunx convex env set AGENT_SERVICE_AUTH_PRIVATE_JWK --from-file /absolute/new/private-directory/AGENT_SERVICE_AUTH_PRIVATE_JWK --deployment strong-bee-384
   bunx convex env set AGENT_SERVICE_AUTH_PUBLIC_JWKS --from-file /absolute/new/private-directory/AGENT_SERVICE_AUTH_PUBLIC_JWKS --deployment strong-bee-384
   bunx convex env set AGENT_SERVICE_AUTH_RELAY_SECRET --from-file /absolute/new/private-directory/AGENT_SERVICE_AUTH_RELAY_SECRET --deployment strong-bee-384
   bunx convex env set AGENT_SERVICE_AUTH_ENABLED true --deployment strong-bee-384
   ```

   Deploy integrated Convex code to that verified production deployment using the existing project release procedure. Preserve all existing auth providers. Regenerate generated API/environment declarations through normal Convex codegen. The additional customJwt provider uses the **public** JWKS inline, avoiding a frontend discovery bootstrap cycle. No private signing key is exposed through metadata or to Next.js.

3. Install only `AGENT_SERVICE_AUTH_RELAY_SECRET` and `AGENT_SERVICE_AUTH_ENABLED=true` in the corresponding **Vercel production** environment, using the protected relay-secret file as stdin/file input. Do not put the private JWK in Vercel or any `NEXT_PUBLIC_*` variable. Keep the existing `NEXT_PUBLIC_CONVEX_URL` pointed at strong-bee-384 and deploy integrated Next.js code.

4. Check local AS metadata and JWKS return 200; PRM lists WorkOS and the local issuer; WorkOS metadata is unchanged. Missing/mismatched/weak/private-in-public key configuration fails closed. Discovery routes verify backend readiness before responding; do not declare activation successful solely because flags were set.

5. Run the live owner-approved smoke:

   `bun scripts/smoke-agent-service-auth.mjs OWNER_EMAIL`

   The script prints a protected temporary **local HTML file path**, never tokens, assertions, claim codes or claim URLs. It checks that protected-resource discovery retains WorkOS alongside the service issuer and that the WorkOS metadata mirror preserves the hosted issuer and endpoints. This is discovery verification, not a fresh WorkOS login test. The owner opens the handoff file, follows the exact production link, signs in, selects the smoke evidence agent, types the displayed code and approves. The script verifies no preapproval issuance, evidence REST access and a real authenticated MCP `tools/call` to `evidence_status`, assertion rejection at both APIs, single-token revocation and successful assertion reuse. It then asks the owner to disconnect the exact registration ID displayed in the console and verifies both REST/MCP denial and `invalid_grant` on exchange. The script revokes its issued access tokens and deletes its own temporary handoff directory on normal completion/failure. A process kill may leave the private directory; remove that exact directory and revoke the smoke registration in the owner console. Do not claim this smoke passed without the real human ceremony.

6. Run existing WorkOS/Ed25519 certification and MCP tools-call checks on the same integrated production release. The new principal flows through the same `getCurrentUser` used by REST, MCP and authenticated artifact handlers; this does not replace their quota or resource checks.

## Error and revocation behavior

- `identity`: rejects anonymous/provider assertions; accepts only `{type:"service_auth",login_hint}`. Returns flat auth.md ceremony fields and no credentials.
- `identity/claim`: only the original claim bearer and original email can mint a new attempt. Works for service_auth retries. Each attempt rotates the URL/code; previous URLs stop working. Outer TTL is 24 hours; a code lasts at most ten minutes. Five incorrect codes lock the attempt.
- `token`: form encoded, no duplicate fields, supports only the profile claim grant and RFC 7523 JWT-bearer. Explicit resource/scope must exactly match. Poll interval begins at five seconds; `slow_down` increases it. Expired/locked attempts return `expired_token`; claims outside the outer TTL return `claim_expired` (410) on re-initiation.
- `revoke`: form encoded, token-specific, empty 200 for unknown/already-revoked tokens. Does not revoke assertions. Owners can revoke one/all their registrations at `/agent/claim`, including when issuance is disabled via the normal backend mutation API.
- Every endpoint returns `Cache-Control:no-store`; claim routes exclude analytics/AI-readable export/robots and set no-referrer. Do not add third-party widgets or URL-capturing telemetry to these pages.
- Rate limits use the existing durable Convex rate-limiter component. Registration: 5/source/hour and 100 globally/hour. All relay operations: 120/source/minute and 3000 globally/minute before cryptographic work. Token issuance: 20/registration/minute. Code submissions: 10/owner/minute plus five failures/attempt. Re-initiation: 3/registration/10 minutes. Outside Vercel, requests share the conservative `unknown` source bucket; never trust client-supplied IP headers on another hosting platform.
- Audit events contain registration/owner IDs and optionally salted network hashes, never codes or credentials. Hourly bounded cleanup marks expired registrations and drains expired tokens, old registrations and 30-day events, with bounded continuation jobs for backlogs. Platform-level access logs are outside this application log policy; apply the host's sensitive-query redaction policy as needed.

## Rollback and key rotation

Disable `AGENT_SERVICE_AUTH_ENABLED` in Convex first: the per-request principal resolver immediately refuses local tokens even before frontend redeployment. Disable Vercel discovery and redeploy. Existing WorkOS and Ed25519 issuers remain unaffected. Owner revocation functions remain available to authenticated humans even while issuance is disabled.

For key rotation, generate a new private JWK and publish its public key **plus** the previous public key (at most three). Install both private/public values in Convex and redeploy auth configuration together. Keep previous public keys at least one hour unless emergency-invalidating all older assertions/tokens. Never reuse the Convex Auth or WorkOS signing key. Relay-secret rotation must be coordinated between Convex and Vercel; a mismatch intentionally makes the relay unavailable. An emergency global stop is the Convex enable flag, not provider metadata editing.

## Verification commands

```sh
bun run test convex/agentServiceAuth.test.ts convex/agentOAuth.test.ts convex/agentIdentity.test.ts lib/agent-service-auth-jwt.test.ts lib/agent-service-auth-discovery.test.ts scripts/agent-service-auth-setup.test.ts
bun run typecheck
bun run typecheck:convex
```

The live smoke is intentionally separate from unit tests. No test mocks count as human production approval, and no deployment is implied by a passing build.
