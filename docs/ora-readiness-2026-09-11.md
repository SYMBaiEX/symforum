# Agent readiness release — 2026-09-11

## Scope

Complete actionable Ora findings with working behavior, truthful discovery and live evidence. PyPI and ChatGPT directory submissions remain paused by the owner. External adoption, editorial coverage and search rankings are not capabilities that a code change can guarantee.

## Released and verified

- Website release `69b5a84102e8355833a95050f77ef21c311573b4`: Vercel production ready, GitHub verification passed, and Convex `strong-bee-384` deployed successfully.
- Native WebMCP: Chrome 152 calls the execution callback without an options argument. The previous destructuring threw before any tool could run. All three native tools now execute successfully; cancellation and a bounded timeout remain supported. A standard Chrome session without preview features had no errors.
- Official MCP registry: `com.symbaiex.www/evidence` and `com.symbaiex.www/docs`, version `1.0.0`, published and independently read back as active/latest. Dedicated Ed25519 domain proof is public; its private key is stored outside Git. Retry-safe publishing checks the entire existing metadata record before skipping an already-published version.
- Documentation: the canonical guides and their machine-readable counterparts respond, and both MCP endpoints are linked from discovery files. Name-based web search still showed poor coverage of the site's own developer guides. IndexNow accepted eleven canonical public documentation URLs with HTTP 200 on September 11; this is receipt, not proof of indexing. The intentionally non-indexed `/agent/instructions` copy was excluded in favor of its HTML canonical `/agent`.
- Public client source: TypeScript SDK, CLI and Python client synchronized to verified source version `0.2.1` in `SYMBaiEX/symbaiex-agent-clients` (`62f4970`). Forty-eight client tests passed. Python source publication is separate from a PyPI submission; none was attempted.

## Remaining release verification

The additive, human-approved `service_auth` implementation is undergoing integration and production acceptance. Existing WorkOS OAuth and Ed25519 authentication remain supported. See [the service-auth runbook](./agent-service-auth.md) for the exact protocol subset, owner ceremony, revocation model and activation checks. Local tests do not substitute for an owner-approved production journey.

## External constraints

- npm: the public repository's verify job passed, but its npm publish job returned a permission/not-found error for `@symbaiex/agent-sdk` (GitHub run `34590040061`). The local npm session also returned 401. The new source is public; the new npm artifacts are **not** confirmed published. Restore the authorized CLI session or configure the correct trusted publisher before retrying. PyPI was skipped.
- The experimental MCP Server Card specification's upstream `$schema` URL returns 404. Keep its published format distinct from the official registry's schema; do not substitute an unrelated schema to manufacture a passing check.
- Search visibility, genuine skills installs, independent coverage and third-party scores require external observation. Do not create fabricated endorsements, reviews or adoption signals.

## Repeatable checks

- `bun run verify` checks application, Convex, client and socials types/tests/builds.
- `bun scripts/publish-mcp-registry.mjs --check` validates the fixed registry records and live endpoints without publishing.
- `bun scripts/submit-developer-indexnow.ts --check` validates the existing ownership proof and fixed public URL allowlist without submitting. Use `--submit` only after substantive public documentation changes; do not repeatedly submit an unchanged batch.
- Run the production auth smoke only with a real owner and explicit manual approval. Never copy credentials or claim links into reports.

Live registry records: [Evidence](https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2Fevidence/versions/1.0.0), [Documentation](https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2Fdocs/versions/1.0.0).
