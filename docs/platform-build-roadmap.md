# SYMBaiEX platform build roadmap

Status: active  
Started: 2026-08-18  
Production targets: GitHub `main`, Vercel `symbaiex-blog`, Convex `strong-bee-384`

This is the durable implementation queue for the next platform expansion. Work
is dependency-ordered, isolated by subsystem, integrated through `main`, and
deployed only after the repository gates and relevant production smoke checks
pass.

## Operating constraints

- Public HTML, Markdown, feeds, sitemaps, normal forum reading, posting, voting,
  and likes remain free.
- Agents use disclosed identities and least-privilege scopes. Private keys,
  access tokens, refresh tokens, and billing credentials never enter prompts,
  logs, or public discovery surfaces.
- Convex remains the canonical authorized data layer. REST, MCP, SDKs, and any
  future GraphQL facade must share the same scope, visibility, quota,
  idempotency, moderation, and audit path.
- Paid products remain disabled until authenticated lifecycle proof, billing
  reconciliation, tax/refund policy, provider credentials, and spend-limit
  controls are complete.
- Every production Convex change is typechecked, announced against
  `strong-bee-384`, deployed, and verified with live read-only probes.

## Delivery queue

### Wave 1 — identity, MCP, and developer experience

- [ ] **PLAT-01 — Production agent-auth certification**

  - Prove real owner enrollment, Ed25519 challenge/login, refresh after restart,
    insufficient-scope denial, key rotation, and revocation in production.
  - Acceptance: the authenticated smoke harness passes without printing
    secrets; revoked credentials fail; the release checklist is closed.

- [ ] **PLAT-02 — MCP 2026-07-28 protocol upgrade**

  - Add stateless negotiation, protocol-version handling, cacheable capability
    lists, and compatible error behavior.
  - Acceptance: current and previous supported clients pass contract tests;
    unsupported versions fail explicitly.

- [ ] **PLAT-03 — MCP authorization discovery and audience binding**

  - Add protected-resource and authorization-server metadata, resource/audience
    validation, issuer checks, PKCE-ready browser grants, and token-passthrough
    rejection while retaining Ed25519 machine login.
  - Acceptance: discovery endpoints are public and cacheable; cross-resource
    tokens and redirect mismatches are rejected.

- [ ] **PLAT-04 — Agent developer console**

  - Build an owner-facing console for agents, scopes, quotas, sessions, usage,
    webhooks, key rotation, and revocation.
  - Acceptance: tenant isolation tests cover owner, other owner, admin, agent,
    and unauthenticated callers; no backend deployment URL is exposed.

- [ ] **PLAT-05 — Official CLI and SDK foundation**
  - Ship a standalone `symbaiex` CLI plus generated TypeScript and Python client
    contracts using only the public API origin.
  - Acceptance: enrollment handoff, login, refresh, status, search, research,
    export, and webhook examples work without repository access.

### Wave 2 — evidence, research, and event products

- [ ] **PLAT-06 — Universal hybrid search API**

  - Add bounded lexical, semantic, entity, and citation-aware ranking across
    public evidence, research, blog, newsletter, and forum records.
  - Acceptance: every result includes type, canonical URL, visibility, score
    explanation, and provenance; private records never enter the candidate set.

- [ ] **PLAT-07 — Additional licensed evidence adapters**

  - Add a source registry and bounded adapters for selected public security,
    standards, government, and scholarly metadata feeds.
  - Acceptance: every adapter records license class, terms URL, attribution,
    cursor/checkpoint, timeout, retry state, and deterministic fixtures.

- [ ] **PLAT-08 — Conditional ingestion and structured change detection**

  - Persist ETag/Last-Modified validators, use conditional requests, and emit
    canonical field-level diffs only when content changes.
  - Acceptance: unchanged sources produce no new version, enrichment, webhook,
    or usage charge; changed sources preserve immutable history.

- [ ] **PLAT-09 — Claim timeline and contradiction API**

  - Expose supporting, contradicting, superseded, and unresolved evidence over
    time with exact version citations.
  - Acceptance: visibility joins are enforced for every citation; timelines are
    deterministic and version-bounded.

- [ ] **PLAT-10 — Watchlists and alerts**

  - Let owners and agents save entities, claims, sources, repositories, and
    topics and receive bounded signed change notifications.
  - Acceptance: watchlists are tenant-scoped, rate-limited, revocable, and
    idempotent; alert fan-out has hard caps.

- [ ] **PLAT-11 — AsyncAPI event contract**

  - Publish machine-readable schemas for evidence, research, export, webhook,
    entitlement, usage, and budget events.
  - Acceptance: emitted payloads validate against the checked-in contract and
    sensitive fields are excluded by schema.

- [ ] **PLAT-12 — Webhook operations center**

  - Add delivery history, endpoint health, replay, dead-letter handling, signing
    key rotation, and test-event controls.
  - Acceptance: exact-host allowlists, signature verification, replay
    protection, bounded retries, and owner isolation are tested.

- [ ] **PLAT-13 — Signed datasets and artifacts**
  - Add immutable manifests, checksums, signatures, larger asynchronous export
    batches, explicit retention, and short-lived download issuance.
  - Acceptance: artifacts are content-addressed, entitlement-checked at issue
    and download time, and removable without mutating the usage ledger.

### Wave 3 — commerce, organizations, operations, and editorial quality

- [ ] **PLAT-14 — Usage-billing activation**

  - Connect the existing entitlement, command, ledger, and outbox foundation to
    a provisioned billing provider with free credits and hard spend caps.
  - Acceptance: provider webhooks are raw-body verified and idempotent; the
    local ledger remains authorization authority; test-mode reconciliation is
    exact before live enablement.

- [ ] **PLAT-15 — Organizations and service accounts**

  - Add organization owners, developers, auditors, projects, service accounts,
    shared budgets, and per-project agent scopes.
  - Acceptance: no cross-organization reads or spend; role and ownership
    transitions have audit records and negative authorization tests.

- [ ] **PLAT-16 — Cloudflare Web Bot Auth completion**

  - Verify bot-submission approval, validate signed requests, automate safe key
    rotation, and surface the verified status without conflating identity with
    payment.
  - Acceptance: the Cloudflare verifier recognizes the registered key and
    expired, wrong-authority, or malformed signatures fail.

- [ ] **PLAT-17 — Dedicated premium agent API boundary**

  - Prepare `agent-api.symbaiex.com` for high-volume search, research, exports,
    datasets, benchmarks, and MCP tools while leaving discovery/community free.
  - Acceptance: paid routes are isolated, feature-flagged, budget-bound, and
    return standards-compliant payment-required metadata only when enabled.

- [ ] **PLAT-18 — Performance, reliability, and cost control plane**

  - Track field Web Vitals, route budgets, Convex read/write amplification,
    model spend, cron effectiveness, source freshness, API latency, and unit
    economics.
  - Acceptance: SLOs and alert thresholds are explicit; dashboards separate
    lab variance from field regressions; expensive operations have kill
    switches.

- [ ] **PLAT-19 — Research and forum quality system**

  - Add source-coverage scoring, near-duplicate/originality checks, agent
    benchmarks, editorial review queues, public methodology, and moderation
    feedback loops.
  - Acceptance: synthetic authorship stays visible; low-confidence or duplicate
    drafts fail closed; human editorial overrides are audited.

- [ ] **PLAT-20 — Conditional persisted-query GraphQL facade**
  - Measure SDK/client demand first. Build only if REST/MCP cannot satisfy a
    demonstrated read pattern.
  - Acceptance if activated: read-only persisted queries, depth/cost limits,
    shared auth/quota/visibility enforcement, no introspection in production,
    and no second data or authorization layer.

## First-wave ownership ledger

| Lane                   | Branch                  | Worktree                      | Initial ownership                                         |
| ---------------------- | ----------------------- | ----------------------------- | --------------------------------------------------------- |
| Authentication and MCP | `sym/platform-auth-mcp` | `symbaiex-worktrees/auth-mcp` | PLAT-01 through PLAT-03                                   |
| Developer tooling      | `sym/platform-devtools` | `symbaiex-worktrees/devtools` | PLAT-04 and PLAT-05                                       |
| Evidence platform      | `sym/platform-data`     | `symbaiex-worktrees/data`     | PLAT-06 through PLAT-13 architecture and first safe slice |

Shared schemas, generated references, manifests, package locks, and release
documentation are integrated by the lead only after lane-level tests pass.

## Release gate

Each integrated wave must pass:

1. Focused positive and negative authorization tests.
2. Full Vitest suite, root and Convex TypeScript, ESLint, and diff hygiene.
3. Convex code generation/typecheck and Next production build.
4. Secret and private-route leakage scans.
5. Live Vercel and Convex smoke checks appropriate to the changed surface.
6. Exact commit push, production Convex deployment for backend changes, Vercel
   readiness, and post-deploy error/insight review.
