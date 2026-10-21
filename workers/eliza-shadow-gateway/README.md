# Eliza shadow gateway

An isolated Cloudflare Workers gateway for the sibling `../eliza-shadow` Node 24
container. This package has its own manifest and Bun lockfile; it does not change
the app's dependencies or grant access to Convex publishing operations.

Only `POST /generate` and `POST /maintenance` can reach the named `pilot`
container. Both require `Authorization: Bearer <ELIZA_SHADOW_WORKER_SECRET>`.
The gateway verifies authorization, JSON content type, uncompressed encoding,
declared content length, and a complete streaming read capped at 128 KiB **before
obtaining a container stub**. It forwards the original body bytes and bearer to
the worker. No baseline, publishing, proxy, arbitrary instance, or lifecycle
control routes are exposed.

`GET /healthz` is public and reports gateway readiness only:

```json
{"ok":true,"scope":"gateway","containerHealth":"not_checked","shadowOnly":true}
```

It never wakes or probes a container and does not establish that ElizaOS, the
provider, or Postgres is healthy. An authenticated generation or maintenance call
is needed to exercise that path.

## Runtime configuration

Provision these three Worker secrets separately, without putting their values
in Wrangler configuration, build arguments, source, or command-line arguments:

- `OPENROUTER_API_KEY`: provider credential used inside the container.
- `DATABASE_URL`: external PostgreSQL connection string used by ElizaOS.
- `ELIZA_SHADOW_WORKER_SECRET`: 32–512 non-whitespace characters, shared with the
  authorized Convex caller and container server.

The `Container` constructor passes only those secrets plus `LOG_LEVEL=error` and
`NODE_ENV=production` through its `envVars` startup configuration. Secrets are
not automatically copied into a running process after a rotation; the container
must next start with the updated environment. There are no source/body/header
logs. Container transport failures use a generic response and suppress the
SDK's default raw-error hook/proxy logging.

Wrangler is pinned to `4.151.3`; `@cloudflare/containers` is pinned to `0.3.7`.
The SDK uses the `default` scheduling policy. The current Wrangler `exports`
configuration enables SQLite-backed Durable Objects; do not add legacy
`migrations` alongside it. The container uses `basic` (1 GiB memory),
`max_instances: 1`, and a five-minute idle timeout, exceeding the worker's
120-second provider deadline. Outbound networking is enabled for OpenRouter
and PostgreSQL. Container disk is ephemeral; persistence belongs in Postgres.

The Dockerfile and explicit `image_build_context` both point to
`../eliza-shadow`, so only that isolated worker package is submitted as Docker
build context, never the app or repository root. Its Dockerfile and
`.dockerignore` belong to the worker package.

## Local verification

From this package directory:

```sh
bun install --frozen-lockfile
bun run types
bun run test
bun run typecheck
bun run deploy:dry
# If Docker is unavailable, validate only the gateway bundle:
bun run deploy:dry:gateway
```

The full dry run validates/bundles the gateway and builds the configured Docker
image locally, without publishing it or provisioning cloud resources. A
Docker-compatible engine is required even in that dry-run mode. The gateway-only
dry run skips the container build and proves neither Docker image build success
nor Container provisioning, secret availability, or live runtime health. A
Docker-compatible engine is also required for `bun run dev`. Local test
credentials can be supplied in the ignored
`.dev.vars` file. Deployment, image publication, database creation and secret
provisioning are separate explicit operational steps, not part of these checks.

Official references used for the pinned configuration: [Container class API](https://developers.cloudflare.com/containers/api/container-class/),
[Wrangler container configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#containers),
and [instance types](https://developers.cloudflare.com/containers/platform/limits/).
