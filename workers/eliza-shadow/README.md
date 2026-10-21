# ElizaOS shadow draft worker

Standalone Node service pinned to `@elizaos/core` and SQL `1.7.2`. Convex alone selects jobs, enforces spending limits, schedules work, evaluates drafts, and owns publication. This service has no Convex credentials, autonomous services, social plugins, tools, scheduling, or publishing endpoint. Each of its Suki/Belle runtimes registers only one model handler.

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
| `OPENROUTER_API_KEY`               | Dedicated, capped OpenRouter inference key                                                                  |
| `DATABASE_URL` or `POSTGRES_URL`   | Dedicated restricted-runtime PostgreSQL login; mandatory in production, with explicit `sslmode=verify-full` |
| `ELIZA_SHADOW_PGLITE_DIR`          | Optional absolute local-test directory, never production                                                    |
| `ELIZA_SHADOW_PROVIDER_TIMEOUT_MS` | Optional 1–120000ms; default 120000                                                                         |
| `PORT`                             | Optional HTTP port; default 8080                                                                            |

Production PostgreSQL startup runs no migrations, schema creation, or RLS changes. It requires a dedicated login without superuser, role/database/schema creation, RLS-bypass, or public-schema CREATE rights. It verifies the pre-provisioned tables and ledger contract using SELECT, then initializes the two character runtimes with ordinary DML. Adapter connections are closed explicitly on SIGTERM/SIGINT; `runtime.stop()` alone does not close them.

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

Input fields: `{version:1, jobId, inputHash, kind, system, prompt, schema, model, maxOutputTokens}`. `kind` is `suki-reply` or `belle-newsletter`. `model` must be `openai/gpt-4.1-mini`; callers cannot select other models. `maxOutputTokens` is an integer from 1 to 10000. Unknown fields, including baselines, are rejected. Identifiers are 1–200 (`jobId`) or 1–128 (`inputHash`) ASCII letters, digits, colons, underscores or hyphens.

Output: `{version:1, jobId, inputHash, output, model, servedModel, inputTokens, outputTokens, providerCostMicroUsd?, durationMs, runtimeVersion:"1.7.2"}`. `output` is validated against the original JSON schema. Provider cost is included only when supplied by OpenRouter; it is not a price estimate. The requesting model and actual served model are reported separately.

Request limit is 128KiB, combined prompt/system limit 100KiB, provider response limit 256KiB, and output limit 128KiB. JSON schemas are bounded by depth/node counts. Ordinary object/scalar/array schemas and unions are supported, including Zod's `$schema` annotation, `uri` (URL constructor) and `safeint` formats. References, regular expressions, unknown formats and unsupported schema keywords are rejected. The provider receives a strict object wrapper around the original schema to support Suki's root union; annotations/formats are removed and `oneOf` is relaxed to `anyOf` only for the provider. The original schema remains authoritative for local validation.

## Failure and retry boundary

Concurrency is one per process; busy requests fail immediately with HTTP 503 (`worker_busy`), never queue. Each accepted job makes at most one HTTP inference request, with no SDK/provider model fallbacks, retries, or repair calls. The timeout covers response reading too. An interrupted or timed-out generation is outcome-unknown and is never retried by this worker.

The PostgreSQL ledger atomically claims each `jobId`, storing the caller's `inputHash` plus a canonical full-request hash. An exact successful redelivery returns the stored result without inference for seven days. Successful draft output is then redacted at startup, maintenance, or redelivery; permanent identifier/hash tombstones remain and return 409 (`job_result_expired`), never another inference call. Convex should call authenticated `/maintenance` every six hours to bound retention even without generation traffic. There is no worker-owned scheduler.

Reusing an ID with changed input returns 409 (`job_input_conflict`). Existing running/unknown jobs return 409 (`job_outcome_unknown`); failed jobs return 409 (`job_failed_no_retry`). These rows require explicit operator reconciliation, not deletion or automatic retry. A new attempt must be authorized/budgeted by Convex and use a new job ID. Tombstones must not be deleted by content-retention cleanup.

Logs contain fixed event/error codes only. Upstream SDK console logging is suppressed; native model-log rows are redacted to runtime/model/provider metadata, never prompts, output, provider error bodies, headers or secrets. The idempotency ledger does retain successful draft output, so database access remains sensitive.

## Cloudflare Containers / Docker

Use this directory (`workers/eliza-shadow`) as the Docker build context. Cloudflare's container wrapper supplies port 8080 and forwards only the generation, maintenance and health routes. Attach a dedicated PostgreSQL database and configure the variables above. Run one logical container instance; do not autoscale concurrent inference replicas. The service starts HTTP only after SQL/runtime initialization; health check is `/healthz`. Do not configure an HTTP-level retry proxy for `/generate`.

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
