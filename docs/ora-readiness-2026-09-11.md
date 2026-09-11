# Agent readiness release — 2026-09-11

## Scope

Complete actionable Ora findings with working behavior, truthful discovery and live evidence. PyPI and ChatGPT directory submissions remain paused by the owner. External adoption, editorial coverage and search rankings are not capabilities that a code change can guarantee.

## Released and verified

- Website release `69b5a84102e8355833a95050f77ef21c311573b4`: Vercel production ready, GitHub verification passed, and Convex `strong-bee-384` deployed successfully.
- Native WebMCP: Chrome 152 calls the execution callback without an options argument. The previous destructuring threw before any tool could run. All three native tools now execute successfully; cancellation and a bounded timeout remain supported. A standard Chrome session without preview features had no errors.
- Official MCP registry: `com.symbaiex.www/evidence` and `com.symbaiex.www/docs`, version `1.0.0`, published and independently read back as active/latest. Dedicated Ed25519 domain proof is public; its private key is stored outside Git. Retry-safe publishing checks the entire existing metadata record before skipping an already-published version.
- Documentation: the canonical guides and their machine-readable counterparts respond, and both MCP endpoints are linked from discovery files. Name-based web search still showed poor coverage of the site's own developer guides. IndexNow accepted eleven canonical public documentation URLs with HTTP 200 on September 11; this is receipt, not proof of indexing. The intentionally non-indexed `/agent/instructions` copy was excluded in favor of its HTML canonical `/agent`.
- Public client source: TypeScript SDK, CLI and Python client synchronized to verified source version `0.2.1` in `SYMBaiEX/symbaiex-agent-clients` (`62f4970`). Forty-eight client tests passed. Python source publication is separate from a PyPI submission; none was attempted.

## Authentication release and acceptance

The additive, human-approved `service_auth` implementation was deployed to Convex `strong-bee-384` and Vercel production at `6bd2aea`. The backend readiness response matched the dedicated public signing keys. Public discovery lists both issuers, and the WorkOS mirror preserves the hosted issuer, authorization endpoint, token endpoint and JWKS URL. Existing WorkOS OAuth and Ed25519 authentication remain supported.

Live checks passed for local issuer discovery and its alias, public-only JWKS, invalid identity/claim requests, rejection of anonymous registration, invalid assertion/grant rejection, idempotent unknown-token revocation, no-store response headers, body-free HEAD, and no-index/no-referrer owner claims. No owner registration was created or approved during these public checks. The new issuer's approved-token acceptance and complete owner disconnect journey still require a real human ceremony; see [the service-auth runbook](./agent-service-auth.md).

Two release-only findings were corrected with regression tests: Convex's auth configuration evaluator has no Node `Buffer`, and the public smoke incorrectly required a challenge to request every supported scope rather than a valid subset (RFC 9728 section 7.2). Neither fix broadens permissions. The deployment evaluator rejected the first attempt before applying it.

A separate isolated-browser check found that `/agent/claim` crashed before a signed-out visitor could reach sign-in: both owner-approval components used the strict `users.viewer` query, which throws for anonymous visitors. The claim and WorkOS connection components now use the existing nullable `users.maybeViewer` query. Ten regressions cover signed-out entry, preserved encoded return URLs, loading, rejection of agent sessions, and continued human access. Private owner queries remain skipped until a human is signed in; the strict backend query is unchanged.

Local verification includes **941 application tests**, both typechecks, lint and production build. SDK 15, CLI 13 and socials 8 tests also passed during the integrated verification. GitHub verification for `6bd2aea` passed. Local builds report an existing stale-development-backend fallback for `posts:listPublishedSummaries`; production checks use the explicitly selected production deployment, not that development backend. Final release and browser acceptance are recorded in the release handoff, separately from the still-pending human approval ceremony.

## Why the fresh scan still misses capabilities

A forced Ora scan completed at **2026-09-11T11:01:29.915Z**, scoring **92/100 (A)**. A subsequent non-forced POST returned this exact result from cache. The public score GET still returned the older 10:09 result; those timestamps must not be confused.

- Ora detects two authorization servers in protected-resource metadata, but its agent-auth check selects only the first, hosted WorkOS issuer. It therefore reports no `agent_auth` block despite the separate local issuer responding with one. Do not rewrite WorkOS metadata or change a working OAuth client's issuer just to influence that check.
- Ora reports `docs: null` and no documentation MCP. Direct production `initialize`, `docs_search` and `docs_get` calls succeeded; search and document reads included the new service-auth instructions. Both server cards and registry records also passed live preflight. This is contradictory discovery evidence, not a missing implementation.
- Ora labels the product MCP unauthenticated because public discovery succeeds. Actual tool calls without a valid token return 401. Keep public discovery accessible and protected actions authenticated.
- Ora sees only the declarative WebMCP preview. Actual native Chrome execution of all three imperative tools passed. Do not polyfill a nonexistent native browser API or claim a simulated callback proves browser support.
- Search sampling still finds weak developer-page coverage. Eleven canonical URLs were accepted by IndexNow, and real registry backlinks are public, but crawling and ranking are external outcomes.

The follow-up adds the current ARD v0.91 `/.well-known/ard.json` path and `rel=ard` discovery while retaining the legacy catalog. All nine entries retain stable identities and targets and add two capability-specific query examples. It also adds direct local auth endpoint URLs to `/auth.md` and visible links to both official registry records in `/developers`; these improve practical discoverability without inventing services or identity claims.

The new catalog passed the official ARD JSON schema. Ora's targeted check nevertheless expected the older `specVersion` envelope, so the catalog retains those compatible legacy fields as well. The service-auth starting points now appear near the top of the authentication guide for clients with shorter reading limits. Targeted checks do not update the full score above.

## External constraints

- npm: the public repository's verify job passed, but its npm publish job returned a permission/not-found error for `@symbaiex/agent-sdk` (GitHub run `34590040061`). The local npm session also returned 401. The new source is public; the new npm artifacts are **not** confirmed published. Restore the authorized CLI session or configure the correct trusted publisher before retrying. PyPI was skipped.
- The experimental MCP Server Card specification's upstream `$schema` URL returns 404. Keep its published format distinct from the official registry's schema; do not substitute an unrelated schema to manufacture a passing check.
- Other directory decisions: [MCP.so's current submission page](https://mcp.so/submit?type=server) requires a $39 publishing fee; no payment was made. [Smithery URL publishing](https://smithery.ai/docs/build/publish) uses its gateway and an authenticated publishing flow; no new Smithery account or proxy connection was created. The two official MCP Registry entries above are already live.
- Search visibility, genuine skills installs, independent coverage and third-party scores require external observation. Do not create fabricated endorsements, reviews or adoption signals.

## Repeatable checks

- `bun run verify` checks application, Convex, client and socials types/tests/builds.
- `bun scripts/publish-mcp-registry.mjs --check` validates the fixed registry records and live endpoints without publishing.
- `bun scripts/submit-developer-indexnow.ts --check` validates the existing ownership proof and fixed public URL allowlist without submitting. Use `--submit` only after substantive public documentation changes; do not repeatedly submit an unchanged batch.
- Run the production auth smoke only with a real owner and explicit manual approval. Never copy credentials or claim links into reports.

Live registry records: [Evidence](https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2Fevidence/versions/1.0.0), [Documentation](https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2Fdocs/versions/1.0.0).
