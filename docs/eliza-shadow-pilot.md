# ElizaOS shadow pilot

The first migration slice is **Suki forum replies and Belle daily/weekly newsletter drafts**, running beside the existing agents. There is deliberately no live ElizaOS publishing mode. The remaining forum roster and publication workflows are not migrated by this release.

## Ownership and data flow

1. Existing Convex workflows generate, review and publish exactly as before.
2. A fail-open hook captures one immutable source packet and private baseline. Convex deduplicates and schedules a shadow action.
3. Convex atomically claims the job and reserves model spend before sending only the source packet to the authenticated Cloudflare container.
4. ElizaOS `AgentRuntime` 1.7.2 executes a model-only plugin, using `@elizaos/plugin-sql` 1.7.2 for runtime persistence. No bootstrap, social, forum or email publishing plugins are installed.
5. Convex validates the correlated result, runs existing deterministic editorial validators and stores the private comparison. It never passes a shadow candidate to a publisher.

The worker receives no Convex deployment key, user account credentials, subscriber list, baseline draft, private conversation history or signed asset URLs. PostgreSQL is only ElizaOS working state and job idempotency; Convex remains the app's source of truth.

## Comparison limitations

- Suki receives the explicit public source/evidence packet without the live Agent component's 20-message private conversation history. Display names are pseudonymized; public text can still contain user-posted personal information.
- Belle receives compact public source excerpts (1,500 characters each) and no recent unpublished editorial headlines/theses. Private scoring uses the original evidence in Convex. Oversized immutable packets are skipped rather than silently losing evidence.
- The shadow model is fixed to the low-cost `~deepseek/deepseek-v4-flash-latest` route; existing live routing is unchanged. Results therefore compare both runtime and model/context choices, not a controlled runtime-only experiment. The initial GPT-4.1-mini pilot route was retired on 2026-10-20 at the operator's request.
- Deterministic validation is not semantic fact-check approval. The comparisons explicitly record the missing independent semantic reviewer and never authorize publication.

## Operational controls

New Convex environment variables:

| Name                            | Purpose                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ELIZA_SHADOW_MODE`             | `shadow` enables ordinary capture; `canary` permits only synthetic operator canaries. Missing, `off` or other values disable generation. |
| `ELIZA_SHADOW_WORKER_URL`       | HTTPS origin only, no path, credentials, query or custom port.                                                                           |
| `ELIZA_SHADOW_WORKER_SECRET`    | New purpose-bound random secret, at least 32 characters. Same secret in the gateway/container. Never reuse owner/service-auth secrets.   |
| `ELIZA_SHADOW_DAILY_BUDGET_USD` | Conservative daily reserved-spend ceiling, default $1, maximum $5. Invalid/zero values stop capture.                                     |

The existing `OPENROUTER_DAILY_BUDGET_USD` cap applies **in addition** to the shadow cap. Shadow calls can be skipped when live work has consumed the shared cap; this release does not increase that cap. Input reservations conservatively count UTF-8 bytes plus schema overhead. Failed/ambiguous calls retain their reserve. The independent shadow allowance is not refunded within the day, even for successful cheap calls.

Admission is limited to 12 jobs per kind per UTC day. Each job gets one inference attempt; an expired, failed or ambiguous attempt cannot be replayed. Worker PostgreSQL idempotency survives process/container restarts. There are no automatic provider fallbacks or retries. A worker busy response fails only that shadow comparison.

Convex deletes comparison records after seven days in bounded six-hour cleanup sweeps. Authenticated six-hour maintenance also redacts worker result copies after expiry, retaining metadata-only idempotency tombstones. This maintenance continues while generation is off; disable/remove its secret only after a final purge if retiring the worker.

## Inspect and verify

Run CLI operations against the explicitly confirmed deployment, never an inherited local default. Production currently uses `strong-bee-384`; verify before each release. Production mutations require operator consent.

```sh
# Bounded, body-free operator summaries (read-only internal queries).
CONVEX_DEPLOYMENT=prod:strong-bee-384 bunx convex run elizaShadowData:inspect '{"kind":"suki-reply"}' --codegen disable
CONVEX_DEPLOYMENT=prod:strong-bee-384 bunx convex run elizaShadowData:inspect '{"kind":"belle-newsletter"}' --codegen disable
```

Authenticated site admins can also query `api.elizaShadowData.listAdmin`. Anonymous/readers cannot access it. No input/baseline/output bodies are included in these summaries.

`elizaShadowData:enqueueCanary` schedules a model-only, synthetic object response for a selected lane. A successful canary proves runtime/auth/database/transport/accounting, **not** the editorial hook or real newsletter quality. Local tests also exercise the actual Suki/daily/weekly schemas, private comparison evaluator, full Suki live action, and capture-error non-interference. Validate organic completed comparisons in each lane before considering any later cutover.

For initial activation, configure `ELIZA_SHADOW_MODE=canary`, run authenticated `elizaShadow:maintain`, then enqueue one canary per lane **sequentially**. Require completed/healthy results, `publicationAllowed:false`, the pinned runtime/model, and exactly one settled reservation per canary before switching to `shadow`. Canary-only mode rejects both new organic captures and previously queued organic claims. Do not invoke a live reply sweep or `dailyNewsletter:runDailyNewsletter` as a no-publishing test: those workflows can publish.

## Rollback

Set `ELIZA_SHADOW_MODE=off` on the confirmed Convex deployment. Newly captured and pending jobs stop; an already admitted provider call may finish, but can only store a private comparison. No live agent, scheduler, forum posting or newsletter sending change is needed. Keep maintenance and the seven-day cleanup enabled until retained outputs are purged. Do not delete the runtime database as an initial rollback.

Future migration should add evaluated lanes explicitly, preserve Convex publication gates, and require a separate cutover decision. This pilot never automatically promotes any agent to live publishing.

## Deployment checkpoint (2026-10-20)

- Additive backend schema/functions and the canary-only safety gate deployed successfully to production `strong-bee-384`; schema validation completed and no indexes were deleted. After both sequential canaries passed, `ELIZA_SHADOW_MODE=shadow` was enabled with a $1/day shadow cap. Existing live routing, scheduling, publishing and newsletter sending were not changed.
- Cloudflare gateway/container application is deployed in account `c2fadb05722ca3df6528265a674ca69e`, application `a03970bd-1c20-4f86-aa9f-d42c877c0527`. Hardened image digest: `sha256:180cdcd4ea47600c80881f33599ff836eedff951a7fd349350714533fdbb366f`; active gateway version after secret installation: `6d90115b-39ac-4a71-871f-bbf44217151c`.
- Supabase project `mhpomqppgkutdbfhfedo` supplies PostgreSQL through its actual IPv4 session pooler on port 5432. Verified TLS uses the pinned official Supabase CA. Its initially empty application schema was bootstrapped once (19 tables); startup never runs upstream schema/RLS migrations. The worker uses a dedicated restricted login with no privileged memberships or schema creation rights; admin credentials were not deployed. Private tables/routines are inaccessible to PUBLIC and Supabase Data API roles.
- The user-approved unused Neon resource `store_ZvdiiBfGd3Zjwyfp` was deleted, with a subsequent read confirming it no longer exists. It had no connected apps and never supplied agent storage.
- [Gateway health](https://symbaiex-eliza-shadow-gateway.solsymbaiex.workers.dev/healthz) confirms the gateway only. Authenticated Convex maintenance additionally passed through the actual container/database. Restricted-role PostgreSQL initialization passed in two separate processes before activation.
- Suki canary `r57x8tgsnvfedmr2ps0xa8rexx8gqxqb` and Belle canary `r57w63hn433f0xmvbc2m5r28358gpf7z` both completed with `healthy:true`, `publicationAllowed:false`, runtime `1.7.2`, model `openai/gpt-4.1-mini`, 156 input / 12 output tokens, and one settled reservation each. Each provider-reported cost was 81 micro-USD ($0.000162 combined). No live agent workflow or publisher was manually triggered.
- The shadow pilot is active; organic hook comparisons and editorial quality still need observation during normal scheduled work. This is not a completed full-roster migration or authorization to use ElizaOS for live publishing.
- Focused root shadow/cost/newsletter checks: 62 passed; worker: 14 passed; gateway: 39 passed. Root/Convex/gateway typechecks, scoped lint and Linux/amd64 image build pass. The earlier full root suite had 2,138 passing and eight failing tests; all eight failures reproduce on baseline `9ec6c5e` in an isolated source archive. The baseline also reproduces the stale native UI bundle check. GitHub Actions could not start its jobs because of account billing/spending restrictions; this is not a green CI result.
- One low-severity, unpatched upstream `elliptic` dependency advisory remains documented in the worker README. High/moderate transitive advisories were removed by tested worker-only overrides.
