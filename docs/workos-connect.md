# WorkOS Connect for SYMBaiEX

This integration preserves Convex Auth for human sign-in and Ed25519 authentication
for existing agents. WorkOS owns the OAuth protocol. SYMBaiEX owns the grant,
agent permission, resource checks, revocation, and quota enforcement.

## Production configuration

- WorkOS project: SYMBaiEX's Project; environment `environment_01JWM5822G1AAZEQ1Z36YDT3SN`.
- Existing AuthKit issuer: `https://unique-evening-77.authkit.app`.
- External sign-in URI: `https://www.symbaiex.com/agent/connect`.
- Allowed resource indicator: `https://www.symbaiex.com/api/agent/mcp`.
- Enable CIMD in Connect > Configuration. Enable DCR only for legacy clients
  that require it. No existing account-login or signing-key replacement is needed.
- Use a server-only WorkOS API key authorized for OAuth completion and looking
  up a user by external ID. Put `WORKOS_API_KEY` only in Convex.
- Set `WORKOS_AUTHKIT_ISSUER` identically in Convex and Vercel production.
- Explicitly set `WORKOS_CONNECT_ENABLED=false` in new Convex environments before
  code generation. Set it to `true` only for the configured deployment during
  activation; keep development and preview separate from production credentials.

The enabled flag declares operational availability, not merely installed code.
Never enable it to satisfy a scanner while the provider configuration is missing.
The site returns a JSON 404 for OAuth discovery while disabled; it retains real
Ed25519 discovery and working authentication throughout.

## Flow and boundaries

1. An MCP client discovers AuthKit through protected-resource metadata and begins
   authorization-code flow with S256 PKCE, state, and the exact resource above.
2. WorkOS redirects to `/agent/connect?external_auth_id=…`. The page is private,
   uncached, no-index, and no-referrer. Existing human sign-in is used.
3. The human selects an active, owned agent with `evidence` access. A bounded
   transaction creates a pending grant, binds the agent's key version, and stores
   only a SHA-256 digest of the temporary request ID. Replays are rejected.
4. A server action calls WorkOS completion with the immutable Convex owner ID
   and contact email. A single dynamic consent choice carries
   `urn:symbaiex:agent-grant`. WorkOS handles application consent and PKCE/token
   exchange. The local grant binds WorkOS's actual `user_…` subject resolved by
   external ID, never a user chosen by matching email.
5. Convex verifies RS256, issuer, expiry and the exact resource audience. The app
   then validates the signed grant, provider subject, owner, current agent status,
   key version, and evidence permission on every request. No owner/admin or posting
   privilege is inherited. Existing evidence quota accounting applies.
6. Disconnecting, revoking the agent, removing evidence permission, or rotating its
   key immediately denies that grant, including tokens minted through refresh.
   This is local access revocation, not deletion of WorkOS users or provider grants.

WorkOS's `openid` and optional `offline_access` scopes are identity/refresh scopes.
They are not the application's `evidence` permission. No invented custom OAuth
scope is sent to the provider. ID tokens are not API credentials.

The first release supports MCP OAuth. Existing SDK/CLI Bearer-token use remains
compatible; native CLI device sign-in is not advertised by the CLI. WorkOS
`agent_auth`, M2M and ID-JAG are distinct features, not implied by Connect.

## Verification and release

Run the WorkOS discovery/authorization tests, existing auth and quota suites,
typechecks, lint, and production build. Mocked provider tests prove application
boundaries, not real provider interoperability.

Activation requires an end-to-end flow with a dedicated test agent and approved
client. Confirm all of these before claiming live OAuth support:

- Provider metadata and JWKS return valid JSON, S256 is supported, and the issuer
  and endpoint origins match. SYMBaiEX's metadata proxy preserves them unchanged.
- Resource discovery advertises that exact issuer; unauthenticated REST/MCP
  responses include the matching Bearer resource-metadata challenge.
- The existing human login returns to the agent selector; complete WorkOS consent.
- Exchange the code, verify the access token is for the exact resource and carries
  the grant claim, then read `/api/agent/v1/status` and call an evidence MCP tool.
- Refresh through WorkOS and repeat the read; disconnect locally and confirm both
  access tokens are denied. Confirm a newly refreshed token is also denied.
- Check unrelated resource audiences, missing grants and another owner's grants
  are denied. Existing Ed25519 sign-in and quota remain functional.

Do not print/store test tokens in source or logs. The existing certification
scripts are specifically for Ed25519, not proof of WorkOS OAuth. Do not use a
production agent's key rotation as a test without the owner's specific approval.

Deploy Convex to `strong-bee-384` and the matching Git release to Vercel. Check
the actual deployment revision and live endpoints. A backend change alone does
not update frontend discovery.

To roll back access, disable Connect in both Convex and Vercel and redeploy the
matching configuration. Existing human sessions and Ed25519 agents stay intact.
Rotating/removing `WORKOS_API_KEY` prevents new completions but does not itself
revoke already issued tokens; disable the provider or revoke local grants as well.
