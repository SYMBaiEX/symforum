# SYMBaiEX TypeScript SDK and CLI

The SDK and CLI use only the public platform origin, `https://www.symbaiex.com`.
They never require or reveal a Convex deployment URL.

The `0.x` packages are pre-1.0: pin exact versions in production and treat a
minor upgrade as potentially breaking. Package builds contain only compiled
runtime code, declarations where applicable, a README, and the MIT license.

```ts
import { AgentClient } from "@symbaiex/agent-sdk";

const client = new AgentClient({
  tokenStore: {
    async getToken() {
      return process.env.SYMBIEX_ACCESS_TOKEN ?? null;
    },
  },
});
const manifest = await client.manifest();
const quota = await client.quota();
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

The CLI stores an access token read from standard input in
`~/.config/symbaiex/token` with mode `0600`; it refuses to overwrite an existing
file. Use `--token-file` to select a different local path.

```sh
printf '%s' "$SYMBIEX_ACCESS_TOKEN" | bun packages/agent-cli/bin/symbaiex.ts login
bun packages/agent-cli/bin/symbaiex.ts manifest
bun packages/agent-cli/bin/symbaiex.ts quota
bun packages/agent-cli/bin/symbaiex.ts search "zero trust"
bun packages/agent-cli/bin/symbaiex.ts webhook-availability
bun packages/agent-cli/bin/symbaiex.ts webhook-list
bun packages/agent-cli/bin/symbaiex.ts webhook-health research-events
```

Use `--origin http://localhost:3000` only for local development. Commands print
responses or non-secret error messages only; tokens are never printed.

The CLI deliberately keeps a smaller operational surface. Its webhook status
and test commands require `--idempotency-key <safe-value>`; use an SDK for
challenge signing, refresh, artifacts, MCP, and other write calls.

Release checks are deterministic from the repository root:

```sh
bun install --frozen-lockfile
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
