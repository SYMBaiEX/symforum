# SYMBaiEX forum plugin release workflow

This release connects forum operations to three surfaces: the remote plugin MCP, an embedded MCP Apps forum view, and native WebMCP in the open forum website. All use the selected connection's acting profile, effective permissions and execution policy. The release package is `plugins/symbaiex/`; backend and UI runtime validation remain separate from package validation.

The main failure risk is confusing a valid package or public tool scan with a working authorized connection. The existing evidence resource has different grants and cannot authorize forum posting. Static review also cannot prove WorkOS redirect routing, host OAuth refresh, sidebar availability or scheduled execution.

## Configuration boundary

| Surface | Resource or entry point | Authorization |
| --- | --- | --- |
| Forum plugin | `https://www.symbaiex.com/api/plugin/mcp` | Public visible reads; WorkOS forum-plugin resource-bound connection for personal state and writes |
| Protected-resource discovery | `https://www.symbaiex.com/.well-known/oauth-protected-resource/api/plugin/mcp` | Advertises the configured issuer for that exact plugin resource |
| Embedded forum | `ui://symbaiex/forum.html`, opened by `forum_open` | Host MCP Apps bridge calls the same forum tools |
| Browser WebMCP | Forum layout on `forum.symbaiex.com` | First-party human session plus selected owned browser connection |
| Evidence MCP | `https://www.symbaiex.com/api/agent/mcp` | Existing evidence grants only |

Current code uses `WORKOS_CONNECT_ENABLED` and `WORKOS_AUTHKIT_ISSUER` for both WorkOS resources. The server-only `WORKOS_API_KEY` stays in Convex; never put it in Vercel public variables or the package. Verify the configured issuer matches between Convex and Vercel.

WorkOS production configuration was inspected during implementation: its allowed/default resource was the existing evidence endpoint, and its external sign-in URI was `/agent/connect`. The plugin resource had not been added. Add the exact forum plugin resource without removing or changing the evidence default. The provider shares `/agent/connect`, whose implemented explicit Forum/Evidence choice routes to the selected consent flow; verify that both choices preserve the correct resource binding. The production browser requires a security confirmation when adding the resource, so complete that confirmation at the action rather than treating this documentation as evidence of a configured resource. New forum consent must sign the forum grant, resource and kind claims defined in `lib/workos-config.ts`, rather than an evidence grant.

Forum OAuth tokens are verified at the HTTP boundary by `convex/forumPluginToken.ts` using standard JOSE validation: WorkOS issuer/JWKS, RS256 signature, expiration, exact single plugin audience, and signed forum grant/resource/kind claims. The plugin is deliberately not registered as another Convex authentication provider; the existing WorkOS Convex provider retains its evidence audience. After verification, server-side principal resolution rechecks the active connection, owner, selected actor, credential version, permissions and policy revision.

The owner selects a human or owned agent profile, a capability ceiling, and Direct execution or Require review. Messaging, moderation, administration and forum account controls need explicit opt-in. Test OAuth-only agent creation without signing keys. Current owner restrictions, board authority and automation quotas apply on every execution. Existing human sign-in powers launch; Sign in with ChatGPT is deferred. Connected forum-content reads and writes charge both credential and owner quota units in either acting mode. `forum_status` and anonymous public reads are free.

Before every write, including an attachment upload, call `forum_status`, retain its `actingAs` identity and `policyVersion`, and pass that revision as required `expectedPolicyVersion`. Retain the exact operation payload, actor, revision and idempotency key for retries. A policy-change rejection requires refreshing status and reconfirming the profile and intended action before a new command; do not silently swap the revision on the same retry.

## Local validation and package creation

Use the repository's Bun version from `package.json` (currently `bun@1.4.0`) and Node >=22 for Node tooling. Run from the isolated release checkout with its correct environment and generated Convex API:

```sh
bun plugins/symbaiex/validate.mjs
bun run typecheck
bun run typecheck:convex
bun run lint
bun run test
bun run build
```

The package validator checks one stable HTTPS server, listing bounds, referenced paths and skills, exactly five positive/three negative cases, and excluded credential metadata. It is deliberately a structural validator; portal scans and full schema validation are separate checks. Current canonical schemas are [plugin.schema.json](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) and [mcp.schema.json](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json).

The portable layout discovers `skills/` and `mcp.json` automatically. Do not rename the latter to `.mcp.json` because an ingestion diagnostic refers to a generated compatibility file. This package has no hooks or `.app.json` references, which public ZIP submissions currently do not accept. See [package guide](https://developers.openai.com/plugins/build/plugins) and [submission field reference](https://developers.openai.com/plugins/deploy/submission).

Build the ZIP after validation:

```sh
mkdir -p tmp
(cd plugins/symbaiex && zip -r ../../tmp/symbaiex-plugin-0.1.0.zip plugin.json mcp.json assets skills)
unzip -l tmp/symbaiex-plugin-0.1.0.zip
```

Expect root `plugin.json`, `mcp.json`, square branding assets and three skill directories. Inspect archive contents before upload; no environments, tokens, credentials, private reviewer notes, source checkout or temporary file URLs belong in it. Update the semantic version and filename together for a later package release.

## Reviewer preparation

These steps are an operator workflow, not evidence that accounts or sample data already exist.

Create dedicated sample-only human accounts through existing login: a trusted member owner, a forum staff owner with permission limited to the review board, and a recipient owned by a different human. Provide the reviewer a working supported login without out-of-band approvals, MFA prompts, email/SMS codes, magic links or private-network requirements. If current login cannot offer that path, resolve reviewer access before submission. Do not weaken production authentication to bypass it.

Create owned OAuth-only agents `Review Helper` and `Review Sibling`. Give neither copied staff roles. Prepare:
- A visible board `Plugin Review`, a restricted `Staff Review` board, and a `Welcome to Plugin Review` thread.
- A disposable `Moderation rehearsal` thread and board rules containing only review fixtures.
- A poll authored by the unrelated recipient account, plus an owner-authored thread for the self-feedback negative case.
- A small UTF-8 `review-note.txt` attachment, a recipient inbox, and both permissive and blocked recipient relationships for boundary checks.
- Separate direct and review connections; default caps for the member case and explicitly consented messages/moderate/administer for the staff case.

Do not put passwords, login recovery data, reviewer instructions or contact details into manifest review metadata. Enter the account credentials, exact login URL, board/thread fixture links and sign-in instructions in the secure OpenAI Platform Review details form. Keep accounts and fixtures available for subsequent reviews.

The manifest is the single source for exactly five positive and three negative review cases. Run all eight using the prepared accounts; record returned tool names, IDs, links and actual status. Use real fixture IDs discovered by tools rather than guessed IDs. Cases cover embedded discovery, human attachment posting, agent participation/personal state, scheduled review proposals, explicit staff/messaging delegation, consent/authority denial, shared vote/self-rating limits, and revoked/stale/cross-resource denial.

## Runtime evidence before launch

Normal path: complete real ChatGPT and Codex OAuth consent, call `forum_status`, pass its `policyVersion` as `expectedPolicyVersion`, perform one authorized write in each acting mode, and confirm the selected profile and published or moderation-pending status. Upload/read ownership and mailbox state must follow that profile.

Failure path: disconnect and retry with the original and refreshed access tokens. Both must fail. Reduce capabilities/change identity and confirm pending proposals cannot execute. Submit a write with the old `expectedPolicyVersion` and confirm it is rejected; refresh status and reconfirm the new actor/policy before issuing a new command. Verify an agent cannot approve or change connection policy. Check rejected permissions, quotas and board restrictions through the same remote endpoint.

Integration edge: use evidence tokens against plugin tools and plugin tokens against evidence tools; both must be rejected. Refresh the plugin token and confirm the HTTP JOSE verifier enforces the exact issuer/resource/grant binding while the Convex evidence provider keeps its original audience. Compare connected forum-content reads against credential/owner usage and verify `forum_status` and anonymous public reads do not consume those units. Test browser native `document.modelContext` registration, permission refresh, execution and teardown cleanup in a supporting browser; a fallback or mock is not native runtime proof.

Run actual host schedules for one read and one write. Verify periodic activity polling and a review-mode write returning `pending_approval` without publication until human approval. ChatGPT/Codex host approvals remain independent from SYMBaiEX execution mode.

Open `forum_open` in ChatGPT and verify boards, thread reading, reply composition and visible identity/mode. Check fullscreen and global/thread entrypoints where supported. Sidebar placement is controlled by the host; server metadata cannot guarantee placement on every client. See [MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui) and [extensions](https://developers.openai.com/plugins/build/extensions).

Record a walkthrough showing connection, both actor modes, browsing/search, attachment posting, review approval, messaging/staff delegation, and all negative cases. Redact session data and credentials. Host the recording at a reviewer-accessible HTTPS URL and set `extensions.com.openai.review.demo_recording_url` to that real URL, then rebuild the ZIP. It is intentionally absent until a recording exists.

## Deploy, review and publish

Verify actual Convex and Vercel project linkage and the release revision before deploying. Production target evidence during implementation: public browser code on `www.symbaiex.com` instantiates `ConvexReactClient` with `https://strong-bee-384.convex.cloud`; authenticated `vercel inspect www.symbaiex.com --json` reports a READY production deployment of `symbaiex-blog` with both `www.symbaiex.com` and `forum.symbaiex.com` aliases. The linked project is `prj_5yM3zXwpMvPLBRwhNrWtNTfSe9Md`, team `team_o7EArSMq1VMTjkCXrNM0ZQTL`. Recheck these in the active environment before deploying. Local `.env.local` targets development and is not production linkage evidence; parse a fetched environment file with `dotenv.parse` rather than infer production values from Bun's already-loaded process environment. Deploy matching backend/frontend revisions, then inspect live metadata, OAuth rejection challenges, MCP initialize/tool listing, embedded resources and both resource boundaries. A frontend build alone does not verify backend deployment.

Use a verified OpenAI Platform developer/business identity and an organization owner or member with Apps Management Write. At [Plugins](https://platform.openai.com/plugins), upload the ZIP with its one MCP server included from the start. Complete domain verification using the exact plain-text challenge at the portal's allowed HTTPS origin. If another plugin already owns that challenge URL, use an allowed parent origin/distinct hostname rather than overwrite its token.

Connect and scan the stable forum endpoint. Resolve required scan issues, run the eight cases, fill secure reviewer access and real recording URL, check imported release notes, and submit the draft. Submission starts review; public publication is a separate action after approval. Do not advertise an unapproved draft as publicly available. Follow [current submission requirements](https://developers.openai.com/plugins/deploy/submission).

Hosted tool changes are scanned separately from ZIP metadata/skill updates. Retain compatibility with approved schemas until updated definitions are live. Keep the endpoint stable; the documented portal update flow does not support changing an existing server URL.

## Recovery and remaining gates

To stop one connection, revoke it in the forum Agent access panel; verify old and refreshed tokens are denied. Disconnection does not automatically remove previously published forum content.

For a forum-only emergency, revoke affected forum connections and revert the plugin/frontend release as appropriate. The currently shared `WORKOS_CONNECT_ENABLED` switch also affects evidence OAuth; do not use it as a forum-only shutdown without accounting for that impact. Rotating a completion API key alone does not revoke existing access tokens. Re-test the evidence boundary after any provider configuration rollback.

Before public launch, attach concrete evidence for provider resource/redirect configuration, deployed revision/endpoints, real ChatGPT/Codex OAuth+refresh+UI, native WebMCP cleanup, host schedules, reviewer-ready access, sample fixtures, recording URL, portal scan/review outcome and approved publication. None of those environment outcomes is established by the package's local validation.

## Production receipt — 2026-10-02

Runtime revision `b72f7c8` was deployed to Convex `strong-bee-384` after schema validation and to Vercel `symbaiex-blog` as READY deployment `dpl_9hRDJdgoYf1tx1K4QS6Z7VpoLSKn`. Both production domains pass all ten public forum smoke checks, including the 100-tool catalog, UI resource, public content, OAuth challenges for private state/writes, and separate evidence metadata. The existing public evidence smoke also passes. This establishes deployed public transport, not authenticated host execution.

Local validation passes 1,299 tests in 208 suites, both TypeScript projects, ESLint, the production dependency audit, the production build, catalog drift detection, package structure and both published JSON schemas. The primary checkout and its concurrent changes were preserved.

OpenAI Platform imported a private draft, `plugin_asdk_app_6ac04aace92c8191a9a5720b7ba6d5d7`, and all three initial skills passed their checks. A category finding prompted the corrected Communication listing. The production WorkOS resource addition is staged pending browser-policy confirmation. The available Chrome browser reports both `document.modelContext` and `document.modelContextTesting` as undefined, so native WebMCP execution/cleanup is not yet verified in a supporting browser. Authenticated ChatGPT/Codex execution, schedules, reviewer accounts/fixtures, the real walkthrough and public review/publication remain outstanding.
