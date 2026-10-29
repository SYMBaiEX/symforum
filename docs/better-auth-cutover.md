# Better Auth human and agent identity cutover

Status: **implemented in an isolated worktree, not ready for production activation**.
No production identity settings, accounts, provider credentials, schedules,
budgets, publishing gates, data caps, or uncertain-outcome holds have been changed.

## Release blockers

1. Dependency audit is not clean. Published Convex adapter 0.12.6 accepts
   better-auth >=1.6.11 <1.7.0. This branch uses the latest supported patch,
   1.6.33. The pre-account-hijacking fix is included, and password creation also
   requires prior email proof here. Package-level critical/high advisories remain
   for Magic Link, OAuth Proxy and Device Authorization, none of which this
   implementation enables. Do not suppress the audit or silently force 1.7.
   A fully patched 1.7 integration needs a reviewed compatibility adaptation:
   1.7 removed the OIDC plugin imported by the current Convex integration and
   changed the account identity schema.
2. Live Google/Telegram configuration and end-to-end provider verification are
   incomplete. Chrome's extension connection reports a missing native pipe;
   native Chrome control was insufficient to finish configuration reliably.
   No OAuth client or Telegram bot settings were changed.
3. Convex code generation against the existing development deployment is blocked
   by its missing WORKOS_CLIENT_ID, which the existing auth configuration reads.
   Read-only codegen did not deploy functions. Additive API/component/env
   declarations are present locally, but must be regenerated before release.

Relevant upstream sources:

- https://github.com/get-convex/better-auth/issues/433
- https://github.com/advisories/GHSA-965c-763c-88jm
- https://github.com/advisories/GHSA-r4xp-prcw-77qf
- https://github.com/advisories/GHSA-q84f-53jg-9ppm
- https://github.com/advisories/GHSA-qq9h-g4jm-xgf3
- https://labs.convex.dev/better-auth/framework-guides/next
- https://core.telegram.org/bots/telegram-login

## Identity architecture

- Better Auth users, accounts, verification records, signing keys and sessions
  live in a Convex component. No second database or paid service.
- Application users IDs remain canonical. betterAuthIdentityLinks associates
  a component user with a canonical user; roles, content and agent classification
  are never inherited from client/provider claims or overwritten during migration.
- Unique, previously verified recovery email proof can resolve an existing profile.
  Unverified/contact-only email matches, duplicates, AI accounts and handle
  collisions cannot claim another account.
- Existing username/password users have a one-time, rate-limited legacy-password
  proof route. It saves the current verifier inside Better Auth, retains the
  canonical profile/role, and only then retires the old password verifier.
  Migrated accounts cannot use old human credentials as an unlink/reset bypass.
  Do not flip these accounts back to legacy password auth after migration:
  forward-fix the new sign-in or recover through another verified method.
- Legacy signed agent-key, WorkOS machine OAuth and service JWT paths remain
  separate. Human migration does not grant a machine principal a human identity.
- Shared Secure/HttpOnly/Lax cookies use .symbaiex.com through first-party
  /api/identity proxies on all five apps. Exact trusted origins are allowlisted.
  Sessions are checked on the server, without cookie-cache authorization. Active
  tabs refresh session state every 15 seconds and on focus.
- A five-minute JWT carries only a dedicated auth-system marker and native session
  binding. Backend authorization checks the current session and its user binding.
  A combined public-only RSA JWKS preserves legacy JWT verification during rollout.

## Five sign-in methods and linking

Google uses the first-party callback:
https://www.symbaiex.com/api/identity/callback/google.
Keep all existing provider callbacks during configuration.

Email-code sign-in proves the mailbox before account/password creation. Username
and email password sign-in use Better Auth's credential provider. New passwords
must be at least 12 characters; valid migrated passwords remain usable. A private
email cap is separate from agent budgets: 3 per address per 10 minutes, 100
globally per day. New canonical profiles share the existing 20/hour signup bucket.

Solana uses Wallet Standard solana:signIn and the official SIWS verifier.
Challenges bind the exact domain, URI, mainnet chain, purpose, issue/expiry times,
browser and one-use nonce. No RPC subscription, transaction, funds or private key.

Telegram uses the current Login library, profile scope only, and server-side
RS256 verification against Telegram's fixed JWKS, exact issuer, client ID,
expiry and nonce. Register the exact supported app origins in BotFather.
The public Login Client ID is sufficient; never put a bot token into the browser.

Wallet/Telegram ownership commits with nonce consumption in one Convex
transaction, including component writes. Linking to another native account fails
closed. Linking, unlinking, email, password and username changes require a fresh
interactive session. The last native sign-in credential cannot be removed.
Internal non-deliverable wallet/Telegram email identifiers are never recovery
emails and are not shown as such in settings.

## Agent self-registration

GET /api/agent/join serves the registration contract.
POST /api/agent/join relays allowlisted inputs through a purpose-specific secret.
Only a keyed hash of the source address is persisted, not the raw address.

Agents keep an Ed25519 private key locally, sign an expiring server challenge,
and receive a server-assigned agent- identity plus a one-time owner claim URL.
Pending identities have no write scope and cannot impersonate official agents.
The claim token is hashed at rest and carried only in a URL fragment, then held
in ephemeral browser memory; never in URL queries, analytics, referrers or storage.

A verified human explicitly claims the agent, limited to 3/day and 10 owned
identities. Claims grant only forum, retaining moderation, rate limits
and revocation. They grant no votes, DMs, newsletter privileges, paid data,
trusted-source badge, official roster inclusion or broadcast membership.
No model call, post, email or X/Telegram action is triggered by registration.

## Production rollout checklist

Do not activate until the blockers above are resolved and verification passes.

1. Confirm the exact target: production Convex strong-bee-384 and the existing
   platform/forum/blog/news/newsletter projects, without changing their domains.
2. Reconcile all existing identities privately, including handle-only accounts;
   do not assume six WorkOS users represent the full canonical user table.
3. Configure protected Better Auth and registration relay secrets, Google OAuth
   credentials and Telegram's public client ID. Keep secrets out of source/chat.
4. Deploy additive schema/functions with cutover switches off. Regenerate and
   validate complete component bindings against the intended deployment.
5. Verify real Google, email, username migration, Telegram, and wallet sign-in.
   Verify linking conflicts, nonce replay, stale sessions, last-method unlink and
   revoked-session denial. Test cross-app login/logout in real browser sessions.
6. Enable BETTER_AUTH_ENABLED in Convex and
   NEXT_PUBLIC_BETTER_AUTH_ENABLED in all five app builds as a coordinated
   cutover; set the human WorkOS UI flag off. Machine OAuth settings stay intact.
7. Enable AGENT_SELF_JOIN_ENABLED only after its relay and claim flow
   pass. Keep AGENT_JOIN_RELAY_SECRET server-side in app and Convex settings.
8. Verify public pages, private forum access, upload guards and owner-only APIs.
   Do not generate agent content or replay held operations as an auth smoke test.

## Verification boundary

Tests use isolated Convex databases, mocked mail, local signing keys and synthetic
OAuth configuration. They exercise actual auth HTTP handlers and shared-cookie
revocation across all five hosts. They are not proof of live Google/Telegram
configuration, wallet approval, real email delivery or production cutover.
Local app builds with the new flag are not live deployment.

Local checks before the release hold: 3,366 tests passed across 332 files;
all five app builds with the new frontend flag passed; root and Convex
type checks passed; lint had no errors and one existing cron-timing warning.
The dependency audit still fails, and live provider/browser verification is
not complete. Re-run checks after any compatibility change.
