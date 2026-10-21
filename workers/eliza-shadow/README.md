# ElizaOS shadow draft worker

Standalone Node service pinned to `@elizaos/core` and SQL `1.7.2`. Convex alone selects jobs, enforces spending limits, schedules work, evaluates drafts, and owns publication. This service has no Convex credentials, autonomous services, social plugins, scheduling, or publishing endpoint. The existing Suki/Belle shadow runtimes remain unchanged; the separate live endpoint lazily instantiates one model-only runtime per allowlisted forum persona.

## Run and verify

From this directory:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run test
bun run start
```

Environment variables (configure in the deployment secret store; never commit values):

| Name                               | Requirement                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ELIZA_SHADOW_WORKER_SECRET`       | Random bearer secret, 32–512 non-whitespace characters                                                      |
| `ELIZA_RUNTIME_WORKER_SECRET`      | Separate live bearer secret, 32–512 non-whitespace characters; absent disables `/complete` only             |
| `OPENROUTER_API_KEY`               | Dedicated, capped OpenRouter inference key                                                                  |
| `DATABASE_URL` or `POSTGRES_URL`   | Dedicated restricted-runtime PostgreSQL login; mandatory in production, with explicit `sslmode=verify-full` |
| `ELIZA_SHADOW_PGLITE_DIR`          | Optional absolute local-test directory, never production                                                    |
| `ELIZA_SHADOW_PROVIDER_TIMEOUT_MS` | Optional 1–120000ms; default 120000                                                                         |
| `PORT`                             | Optional HTTP port; default 8080                                                                            |

Production PostgreSQL startup runs no migrations, schema creation, or RLS changes. It requires a dedicated login without superuser, role/database/schema creation, RLS-bypass, or public-schema CREATE rights. It verifies the pre-provisioned tables and ledger contract using SELECT, then initializes the two character runtimes with ordinary DML. On SIGTERM/SIGINT, the HTTP server and both services stop accepting new work, existing generation calls drain under their existing provider deadlines, and adapter connections close afterward. The explicit `close()` methods still abort active calls for forced shutdown and tests; `runtime.stop()` alone does not close adapter connections.

### One-time PostgreSQL bootstrap

Use a dedicated database/project. Before the first deployment, provide its admin URL through the one-time `ELIZA_SHADOW_BOOTSTRAP_DATABASE_URL` secret and run locally:

```sh
bun run bootstrap:postgres
```

The helper refuses any existing public base table, existing public-table RLS, or migration metadata before invoking Eliza's migrator. It then creates the pinned Eliza schema and ledger and revokes PUBLIC/Supabase Data API role access to the new tables. Never bypass this guard for a shared populated database: Eliza SQL 1.7.2 has a legacy migration preflight that can disable public-table RLS before its dry-run checks. `ENABLE_DATA_ISOLATION=true` is rejected; it is not a safe substitute for isolating the bootstrap.

After bootstrap, provision the restricted runtime role and grant CONNECT to this database, USAGE on `public`, SELECT/INSERT/UPDATE on `agents` and `eliza_shadow_jobs`, SELECT/INSERT on `worlds`, `entities`, `rooms`, `participants`, and INSERT on `logs`. Do not make it a member of `postgres`, `service_role`, or other privileged Supabase roles. Keep the migration owner/admin URL out of container secrets. These grants cover the model-only lifecycle, not arbitrary Eliza plugins; verify the restricted login with real PostgreSQL before enabling dispatch.

Supabase shared **session** pooler port 5432 is the IPv4-compatible choice; copy its actual hostname from the dashboard rather than guessing it. Transaction pooler port 6543 is not suitable for the upstream migrator's session advisory locks. Direct Supabase connections normally require IPv6 (unless the project has its IPv4 add-on). Use verified TLS with the Supabase CA provided through a trusted root store or a mounted certificate referenced by `sslrootcert`; never use `sslmode=no-verify`, an unverified TLS workaround, or `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Runtime pool limits are 2 connections, 5s connection timeout, 10s idle lifetime, 15s SQL statement timeout, 20s client-query timeout and 5s lock timeout. The bootstrap uses one persistent session, 60s statement and 65s query limits. Only local PGlite automatically bootstraps at runtime.

## HTTP contract v1

`GET /healthz` is public and returns only startup readiness, `shadowOnly`, runtime version and busy state. `POST /generate` requires `Authorization: Bearer <worker secret>` and `Content-Type: application/json`. `POST /maintenance` uses the same secret and a JSON `{}` body; it redacts expired results and checks database readiness without making any model call. Its safe response includes `ok`, `purgedResults` and the runtime version.

Input fields: `{version:1, jobId, inputHash, kind, system, prompt, schema, model, maxOutputTokens}`. `kind` is `suki-reply` or `belle-newsletter`. `model` must be the cheap DeepSeek alias `~deepseek/deepseek-v4-flash-latest`; callers cannot select other models. `maxOutputTokens` is an integer from 1 to 10000. Unknown fields, including baselines, are rejected. Identifiers are 1–200 (`jobId`) or 1–128 (`inputHash`) ASCII letters, digits, colons, underscores or hyphens.

Output: `{version:1, jobId, inputHash, output, model, servedModel, inputTokens, outputTokens, providerCostMicroUsd?, durationMs, runtimeVersion:"1.7.2"}`. `output` is validated against the original JSON schema. Provider cost is included only when supplied by OpenRouter; it is not a price estimate. The requesting model and actual served model are reported separately.

Request limit is 128KiB, combined prompt/system limit 100KiB, provider response limit 256KiB, and output limit 128KiB. JSON schemas are bounded by depth/node counts. Ordinary object/scalar/array schemas and unions are supported, including Zod's `$schema` annotation, `uri` (URL constructor) and `safeint` formats. References, regular expressions, unknown formats and unsupported schema keywords are rejected. The provider receives a strict object wrapper around the original schema to support Suki's root union; annotations/formats are removed and `oneOf` is relaxed to `anyOf` only for the provider. The original schema remains authoritative for local validation.

The shadow DeepSeek request sets native `reasoning:{enabled:false}` so the bounded completion budget remains available for draft text instead of hidden reasoning. It still sends one non-streaming strict-schema request with provider fallback disabled.

## Live HTTP contract v2

`POST /complete` requires the distinct `ELIZA_RUNTIME_WORKER_SECRET` bearer. The shadow key never authorizes this route, and the live key never authorizes `/generate` or `/maintenance`. A missing live key leaves shadow running and returns `live_not_configured` on `/complete`. `GET /healthz` reports `liveAvailable` only when configured; it does not call the provider.

The request is `{version:2,jobId,inputHash,agentSlug,stage,body}`. `body` is the exact non-streaming OpenAI chat-completion JSON emitted by the installed SDK; the worker validates bounds and allowed fields, but neither rewrites its model/messages/tools/schema/options nor adds a second model adapter. It must include `max_tokens` or `max_completion_tokens` from 1 to 40000. `inputHash` is lowercase SHA-256 of `JSON.stringify(body)` after recursively sorting object keys with JavaScript's default `.sort()` (arrays retain order). The SQL ledger also hashes the entire v2 envelope. The model is limited to `openrouter/free` or `~deepseek/deepseek-v4-flash-latest`. The 30 roster slugs plus Suki, Belle and Nyx are allowlisted, and stages must match the named agent's forum or Belle newsletter/digest workflow; only Belle may use `belle:daily-signal:evidence-review` and `belle:weekly-field-note:evidence-review`. `system` is limited to `health-canary`. Unknown fields, streaming, remote schema references, arbitrary URLs/options and unapproved model overrides are rejected.

Success returns `{version:2,jobId,inputHash,agentSlug,stage,runtimeVersion:"1.7.2",completion}`. The bounded original OpenAI completion is preserved, including usage/cost/model fields. Only a narrow set of definite provider 4xx rejections returns `{error:"provider_rejected",providerStatus,outcomeUnknown:false}` at that HTTP status. Ambiguous HTTP 408/409, embedded provider errors, network, timeout, provider 5xx and ambiguous results fail closed with fixed error codes and `outcomeUnknown:true`; raw provider content is never returned. An active provider call aborted by worker shutdown reports `provider_shutdown` rather than `provider_timeout`; both remain unknown outcomes that cannot be retried under the same job ID. For a 200 response, `provider_unexpected_stream`, `provider_invalid_json`, `provider_empty_response`, `provider_response_too_large`, and fixed `provider_invalid_envelope`, `_id`, `_choices`, `_message`, `_model`, or `_usage` codes distinguish protocol and shape failures without retaining the response body. A non-streaming request never promotes SSE frames to a successful completion. The worker makes one HTTP request, with no retries or its own fallback. Live admission permits two different personas at once, never two overlapping runs of one persona; the pre-claim busy response is 503. Shadow retains its own single-flight lane. Durable replay and tombstones use the existing private ledger.

`POST /status` uses the same distinct live bearer but is read-only. It accepts only `{jobId}` (1–200 safe ASCII characters; at most 512 request bytes) and returns ledger state, fixed error code, hashes, and timestamps. It never returns the stored completion, calls a provider, claims or mutates a job, or publishes content. Unknown job IDs return a safe 404. This endpoint is for operator reconciliation of held jobs; it is not a retry or tombstone-clearing API.

## Failure and retry boundary

Shadow concurrency is one per process; busy requests fail immediately with HTTP 503 (`worker_busy`), never queue. Each accepted job makes at most one HTTP inference request, with no SDK/provider model fallbacks, retries, or repair calls. The timeout covers response reading too. An interrupted or timed-out generation is outcome-unknown and is never retried by this worker.

The PostgreSQL ledger atomically claims each `jobId`, storing the caller's `inputHash` plus a canonical full-request hash. An exact successful redelivery returns the stored result without inference for seven days. Successful draft output is then redacted at startup, maintenance, or redelivery; permanent identifier/hash tombstones remain and return 409 (`job_result_expired`), never another inference call. Convex should call authenticated `/maintenance` every six hours to bound retention even without generation traffic. There is no worker-owned scheduler.

Changing the fixed shadow model does not alter old ledger rows or run a migration. A reused `jobId` whose old request included a different model returns `job_input_conflict`; it never replays old output or silently issues a new inference request.

Reusing an ID with changed input returns 409 (`job_input_conflict`). Existing running/unknown jobs return 409 (`job_outcome_unknown`); failed jobs return 409 (`job_failed_no_retry`). These rows require explicit operator reconciliation, not deletion or automatic retry. A new attempt must be authorized/budgeted by Convex and use a new job ID. Tombstones must not be deleted by content-retention cleanup.

Logs contain fixed event/error codes only. Upstream SDK console logging is suppressed; native model-log rows are redacted to runtime/model/provider metadata, never prompts, output, provider error bodies, headers or secrets. The idempotency ledger does retain successful draft output, so database access remains sensitive.

## Cloudflare Containers / Docker

Use this directory (`workers/eliza-shadow`) as the Docker build context. Cloudflare's container wrapper supplies port 8080 and forwards only the generation, maintenance, completion and health routes. Attach a dedicated PostgreSQL database and configure the variables above. Run one logical container instance; do not autoscale concurrent inference replicas. The service starts HTTP only after SQL/runtime initialization; health check is `/healthz`. Do not configure an HTTP-level retry proxy for `/generate` or `/complete`.

For a local image build from the repository root:

```sh
docker build -t symbaiex-eliza-shadow workers/eliza-shadow
```

Start with Convex shadow dispatch disabled, deploy this service, check health, then let Convex run a small capped shadow sample. Rolling back means disabling Convex dispatch and stopping this service; do not delete the ledger/database. This worker does not change existing content publication behavior.

Tests use real core/SQL lifecycle with temporary PGlite storage and a mock provider. They make no paid inference requests. Production PostgreSQL and Cloudflare deployment require separate live verification.

## Dependency security boundary

Worker-only overrides pin `pdfjs-dist` to `6.2.108` and `esbuild` to `0.28.2` to remove the known high/moderate transitive advisories in the original Eliza dependency tree. The actual Eliza core/SQL versions remain `1.7.2`; runtime imports, schema migration and draft lifecycle are tested with these overrides. PDF processing and esbuild's development server are not exposed by this worker.

`bun audit --production` still reports one low-severity [elliptic advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84), through core's unused browser-crypto dependency. The latest published elliptic version is `6.6.1`, with no fixed release at verification time. This is a documented residual dependency risk, not a clean audit. The worker uses Node's native SHA-256/timing-safe comparison for authentication and idempotency, never elliptic operations.

API references: [Eliza runtime](https://docs.elizaos.ai/agents/runtime-and-lifecycle), [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs), [Ajv security](https://ajv.js.org/security.html). Exact Eliza behavior is additionally verified against the pinned npm package; current docs contain examples for other versions.
