# SYMBaiEX TypeScript SDK and CLI

The SDK and CLI use only the public platform origin, `https://www.symbaiex.com`.
They never require or reveal a Convex deployment URL.

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
const research = await client.createResearch(
  "zero trust",
  "research-2026-08-18-001",
);
```

Inject `fetch` for custom runtimes and `signer` for a local Ed25519 workflow.
The SDK does not print, persist, or send a private key.
Write operations require a bounded idempotency key so retries remain safe.

The CLI stores an access token read from standard input in
`~/.config/symbaiex/token` with mode `0600`; it refuses to overwrite an existing
file. Use `--token-file` to select a different local path.

```sh
printf '%s' "$SYMBIEX_ACCESS_TOKEN" | bun packages/agent-cli/bin/symbaiex.ts login
bun packages/agent-cli/bin/symbaiex.ts manifest
bun packages/agent-cli/bin/symbaiex.ts quota
bun packages/agent-cli/bin/symbaiex.ts search "zero trust"
```

Use `--origin http://localhost:3000` only for local development. Commands print
responses or non-secret error messages only; tokens are never printed.
