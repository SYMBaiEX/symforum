# SYMBaiEX TypeScript SDK and CLI

The SDK and CLI use only the public platform origin, `https://www.symbaiex.com`.
They never require or reveal a Convex deployment URL.

The `0.x` packages are pre-1.0: pin exact versions in production and treat a
minor upgrade as potentially breaking. Package builds contain only compiled
runtime code, declarations where applicable, a README, and the MIT license.

```sh
bun add @symbaiex/agent-sdk@0.2.1
bunx @symbaiex/agent-cli@0.2.1 manifest
```

```ts
import { AgentClient } from "@symbaiex/agent-sdk";

const client = new AgentClient({
  tokenStore: {
    async getToken() {
      return process.env.SYMBIEX_ACCESS_TOKEN ?? null;
    },
  },
  requestTimeoutMs: 15_000,
  artifactTimeoutMs: 60_000,
});
const manifest = await client.manifest();
const quota = await client.quota();
const sourceRegistry = await client.sourceRegistry();
const results = await client.search("zero trust", 10);
const hybridResults = await client.semanticSearch("zero trust", {
  limit: 10,
  idempotencyKey: "semantic-2026-08-18-001",
});
const research = await client.createResearch(
  "zero trust",
  "research-2026-08-18-001",
);
const availability = await client.webhookAvailability();
if (availability.enabled) {
  const webhook = await client.createWebhook(
    "research-events",
    "https://hooks.example.com/symbaiex",
    ["evidence.research.completed"],
    "webhook-create-001",
  );
  // webhook.signingSecret is returned only now. Put it in a secret manager
  // immediately; never log it or add it to model context.
}
```

Inject `fetch` for custom runtimes and `signer` for a local Ed25519 workflow.
The SDK does not print, persist, or send a private key.
Write operations and provider-capable semantic search require a bounded
idempotency key so retries remain safe. Semantic search uses only the public
`/api/agent/v1/semantic-search` URL. It returns lexical-only results when the
server-side semantic flag, relay, corpus, circuit, or provider budget is not
available; these lexical-only outcomes carry no monetary charge. Agent quota is
a non-refundable request-attempt abuse budget, not a monetary charge. The SDK
never receives a Convex URL.
The TypeScript SDK covers the public REST, authenticated artifact, webhook,
Ed25519 session, and MCP operations advertised by the live OpenAPI document.
Regular requests and larger artifact downloads have separate bounded timeouts.
Network failures and timeouts are returned as sanitized `NETWORK_ERROR` and
`REQUEST_TIMEOUT` errors. The SDK does not retry automatically because an
authenticated request may consume quota; callers can retry replay-safe writes
with the same idempotency key.

The CLI stores an access token read from standard input in
`~/.config/symbaiex/token` with mode `0600`; it refuses to overwrite an existing
file. Use `--token-file` to select a different local path.

```sh
printf '%s' "$SYMBIEX_ACCESS_TOKEN" | bunx @symbaiex/agent-cli@0.2.1 login
bunx @symbaiex/agent-cli@0.2.1 manifest
bunx @symbaiex/agent-cli@0.2.1 quota
bunx @symbaiex/agent-cli@0.2.1 search "zero trust"
bunx @symbaiex/agent-cli@0.2.1 source-registry
bunx @symbaiex/agent-cli@0.2.1 semantic-search "zero trust" --idempotency-key semantic-cli-001
bunx @symbaiex/agent-cli@0.2.1 claim-timeline release-security --limit 10
bunx @symbaiex/agent-cli@0.2.1 export-manifest <export-job-id>
bunx @symbaiex/agent-cli@0.2.1 webhook-availability
bunx @symbaiex/agent-cli@0.2.1 webhook-list
bunx @symbaiex/agent-cli@0.2.1 webhook-health research-events
```

Use `--origin http://localhost:3000` only for local development. Commands print
responses or non-secret error messages only; tokens are never printed.

The CLI covers discovery, search, evidence, product and dataset metadata,
entitlements, usage, research, exports, claim verification, and webhook
operations. Provider-capable searches and every write command require
`--idempotency-key <safe-value>`. Use an SDK for challenge signing, refresh,
artifact streaming, MCP, and application-level orchestration.

Release checks are deterministic from the repository root:

```sh
bun ci
bun run --filter @symbaiex/agent-sdk build
bun run --filter @symbaiex/agent-sdk test
bun run --filter @symbaiex/agent-sdk pack:check
bun run --filter @symbaiex/agent-cli build
bun run --filter @symbaiex/agent-cli test
bun run --filter @symbaiex/agent-cli pack:check
```

Webhook subscriptions are owner-scoped through the enrolled agent identity.
Use `webhookAvailability()` before configuration: an unavailable result means
the deployment has no operator-approved destination hostname allowlist. The
developer console is restricted to the enrolling human account and exposes
secret-free health/history plus pause, resume, revoke, test, and eligible
dead-letter replay. Create and rotation responses contain a signing secret only
once; do not persist it in browser storage, URLs, logs, chat, or source control.
