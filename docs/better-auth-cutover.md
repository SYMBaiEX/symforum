# Better Auth human and agent identity cutover

Status: **human sign-in activated in production; live verification in progress**.
The owner approved activation and live testing on October 28, 2026. PR #177 is
merged; Better Auth is enabled on Convex strong-bee-384 and the five existing
Vercel projects. Production domains retain their existing project assignments.
Existing canonical account identity fields, agent configurations and historical
uncertain-outcome holds were compared against the pre-activation baseline and
remain unchanged. New authentication mappings and clearly named test profiles
are additive. No agent schedules, budgets, publishing gates or data caps changed.

## Verification and remaining boundaries

1. Dependency compatibility is resolved locally with the maintained patch below.
   Better Auth is pinned to 1.7.14; the production dependency audit reports zero
   vulnerabilities. This is not proof of live provider configuration.
2. A separate Google web client is configured and published for standard
   profile/email sign-in; the legacy Google client remains untouched. The real
   Google callback and shared browser session were verified. The primary
   @symbaiex_bot uses Telegram's current login library, six exact first-party
   origins and default RS256 signing. A real Telegram sign-in reached account
   connections. Profile scope only is requested, never phone or messaging.
3. Production signed-wallet HTTP login, handle editing, canonical binding,
   shared sessions on all five domains, cross-domain logout and denial of the
   revoked JWT passed after PR #187 fixed case-sensitive internal identifiers.
   No transaction, funds, model call or publication was used. A test verification
   email was delivered; the mail connector intentionally withholds login codes.
   Email-code/password HTTP tests pass locally, but do not claim their live
   end-to-end verification complete until an owner completes those steps.
4. GitHub Actions did not start the PR jobs: the account reports failed recent
   payments or an insufficient spending limit. No billing settings were changed,
   no paid upgrade was requested, and checks were not bypassed. Five production
   builds completed during activation. Agent self-registration remains disabled
   until its separate enrollment rollout is explicitly authorized and verified.

Relevant upstream sources:

- https://github.com/get-convex/better-auth/issues/433
- https://github.com/advisories/GHSA-965c-763c-88jm
- https://github.com/advisories/GHSA-r4xp-prcw-77qf
- https://github.com/advisories/GHSA-q84f-53jg-9ppm
- https://github.com/advisories/GHSA-qq9h-g4jm-xgf3
- https://labs.convex.dev/better-auth/framework-guides/next
- https://core.telegram.org/bots/telegram-login

### Wallet picker and browser verification

Wallet login/linking uses the shared accessible dialog and Wallet Standard
discovery. Selecting a connect/message-capable wallet invokes `standard:connect`
directly from that click, prepares a fresh server challenge after account
selection, then requires a separate explicit click to sign the canonical SIWS
message with `solana:signMessage`. The combined `solana:signIn` RPC is not forced
on these wallets. SIWS-only wallets prepare a challenge after selection and invoke
`solana:signIn` directly from a separate signing click. Opening the picker alone
does not allocate a challenge. Cancellation or expiry requires a new explicit
selection. Ethereum globals, transactions and spending permissions are not used.
Server proof, ownership, browser binding and replay checks are unchanged.

The Telegram SDK loads only when selected. Production CSP permits its exact
static stylesheet hash on `/signin` and `/account/connections` only, without
adding `unsafe-inline` or broadening script permissions.

Isolated browser tests cover the dialog, user activation, duplicate clicks,
cancellation, expiry, failed challenge, message-only and SIWS-only discovery,
multiple accounts, session confirmation and focus return. They execute the real
Better Auth client/session atom, with fake wallets, an isolated Convex boundary
and fully intercepted traffic. Passing these tests or the signed-wallet HTTP
test does not prove the real extension completes authentication.

The real Phantom flow subsequently reached its confirmation prompt but reported
an internal signing error afterward; the checked production challenges were
not consumed. This is not evidence that the wallet was still locked, nor proof
of the underlying extension failure. The former recovery-only connect/message
route is now the normal path for compatible wallets. It never automatically
retries signing. Connection does not authenticate; a fresh server challenge and
a second user click are required to sign the canonical SIWS message. Multiple
connected accounts require an explicit account choice.
Changed accounts/messages, stale challenges and cancelled requests fail closed.
The same backend verifier and account/linking ownership checks are used, with
no new endpoint, provider permission, database write path or production setting.

Wallet-request, server-verification and session-confirmation errors are shown
separately. A successful wallet response is not reported as a completed login
until a native session with both session and user IDs is returned. Real-extension
completion remains unverified until the actual approval succeeds.

An app lifecycle regression was reproduced before the fix: the signed-out
session's focus refresh sets `isPending`, causing the root identity bootstrap to
unmount the public sign-in form and its active wallet flow. Only exact `/signin`
now remains mounted through session/identity refreshes. Other routes still wait
for verified Convex auth and canonical identity bootstrap; ownership failures
remain blocked. Custom wallet/Telegram proof exchanges explicitly refetch the
subscribed Better Auth session atom before completion. An independent
`getSession()` response does not notify that atom; initial-only `hydrateSession`
is not a substitute. The existing Convex JWT bridge and reviewed dependency
patch remain unchanged; no provider type assertion or additional compatibility
patch was introduced. Regression tests keep the flow alive during a real guest
focus refetch and check the subscribed session becomes authenticated after proof
exchange, while missing sessions fail closed.

## Maintained Better Auth 1.7 compatibility patch

`patches/@convex-dev%2Fbetter-auth@0.12.6.patch` is applied by Bun's
`patchedDependencies`, including frozen installs in Vercel. The npm package
and public adapter interfaces remain upstream 0.12.6; only the reviewed changes
listed here are carried locally, in source, runtime distribution and declarations:

- Pin the compatibility peer to the tested Better Auth 1.7.14, not a floating
  major override. All Better Auth core packages resolve to that release.
- Remove the deleted in-core OIDC-provider import from the Convex plugin and
  schema-generation options. Expose only fixed issuer/JWKS discovery metadata;
  no OAuth authorization, consent, registration or token server is added.
  Existing native JWT, bearer/session, cookie and revocation hooks remain.
- Strip factory-only `modelKey` metadata before calling component functions.
  Reject case-insensitive selectors as upstream does; the accepted sensitive
  mode is not forwarded as unrecognized metadata. Keep every value predicate.
- Allow immutable `_creationTime` as an additional conditional-write predicate,
  preserving all snapshot guards used by 1.7's atomic consume/increment fallback.
  Never drop that guard or replace an atomic operation with read-then-delete.
- Add optional JWKS `alg`/`crv` fields required by the current JWT plugin, plus
  an account identity/user compound index. No account ownership schema change:
  1.7.3 restored the 1.6 `(providerId, accountId)` identity contract.
- Enforce unique rate-limit keys inside the component creation transaction via
  an application trigger, so concurrent first requests cannot create independent
  quota buckets. Existing user/provider ownership triggers remain.

Regression coverage exercises real native HTTP handlers, signed SIWS login,
cryptographic RSA JWT verification, five-host sessions/logout, duplicate rate
keys, conditional increments and one-use proof consumption under concurrency.
The database adapter's conditional mutation and affected-row counts are retained.
Unused OAuth/Magic Link/device/key-administration endpoints remain inaccessible.

Unrelated dependency advisories are resolved by pinning compatible
`@react-email/render` 2.2.0 (which uses html-to-text 10/deepmerge-ts) and `qs`
6.17.1. No audit ignore, threshold reduction or invented package version is used.

Maintenance: review upstream issue #433 and adapter releases before upgrading.
Remove this patch only when upstream natively supports the selected Better Auth
release and all identity/concurrency tests pass. Regenerate component bindings
and rerun the complete audit/build/test suite for every patch change.

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
  If a newly proven native identity has not yet been mapped to any application
  profile, a fresh native session plus the old password may bind it to the old
  profile. This avoids orphaning a first Google/email sign-in. Two already-mapped
  application profiles are never silently merged.
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
The new client uses BETTER_AUTH_GOOGLE_CLIENT_ID and
BETTER_AUTH_GOOGLE_CLIENT_SECRET, separate from the existing legacy
AUTH_GOOGLE_ID/SECRET. Never overwrite the old pair during preparation.

Email-code sign-in proves the mailbox before account/password creation. Username
and email password sign-in use Better Auth's credential provider. New passwords
must be at least 12 characters; valid migrated passwords remain usable. A private
email cap is separate from agent budgets: 3 per address per 10 minutes, 100
globally per day. New canonical profiles share the existing 20/hour signup bucket.

Solana uses Wallet Standard connect/message signing (or `solana:signIn` for
SIWS-only wallets) and the official SIWS verifier.
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

New Telegram profiles suggest the cryptographically verified preferred_username;
wallet-first profiles suggest a first-six/last-four address block. Handles are
case-insensitive and editable. Occupied suggestions receive a bounded stable
suffix; missing Telegram usernames receive a non-identifying fallback. Provider
linking and later provider-name changes never overwrite a chosen handle. Older
provider profiles may receive a default on their next verified login only if
their native handle is missing and the canonical profile is still auto-named.

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

Use this checklist for subsequent environments and follow-up verification.
Production activation is already owner-approved; do not blindly reset its flags
or migrated accounts to legacy password authentication.

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

Local checks after the compatibility patch: 3,373 tests passed across 332 files;
all five app builds with the new frontend flag passed; root and Convex
type checks passed; lint had no errors and one existing cron-timing warning.
The production dependency audit reports zero vulnerabilities. Live
provider/browser verification is not complete. Re-run checks after changes.

One earlier concurrent full-suite/build run passed all assertions but returned
a Vitest console-RPC teardown error in telegramMemes.test.ts. That file passed
in isolation, then the entire suite passed without concurrent builds. No error
suppression or test exclusion was added.

A bounded, complete read-only production account inventory on October 28 found
156 canonical profiles: 110 non-agent profiles (which may include test accounts),
46 agent profiles, 105 handle-only profiles and 5 verified real recovery emails.
No verified email required case normalization and no verified email group was
duplicated. These are profile counts, not verified counts of unique people.
No account rows or external WorkOS users were changed.
