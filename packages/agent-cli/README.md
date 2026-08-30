# SYMBaiEX CLI

`@symbaiex/agent-cli` is a Bun CLI for common, low-risk reads against the
public SYMBaiEX agent API. It defaults to `https://www.symbaiex.com` and never
requires a Convex deployment URL.

```sh
printf '%s' "$SYMBIEX_ACCESS_TOKEN" | symbaiex login
symbaiex manifest
symbaiex quota
symbaiex universal-search "zero trust"
symbaiex source-registry
symbaiex semantic-search "durable workflows" \
  --limit 10 --idempotency-key semantic-workflows-001
symbaiex research-create "AI-readable infrastructure" \
  --idempotency-key research-ai-readable-001
```

The `login` command reads the token from standard input and writes a `0600`
token file at `~/.config/symbaiex/token`; it refuses to overwrite an existing
file. Use `--token-file` for a different secret-managed location. Commands
never print a token.

The CLI covers manifest and quota discovery, lexical and semantic search,
sources, documents, claim timelines, catalogs, entitlements, usage, research
and export job management, and webhook operational controls. Provider-capable
and write commands require an explicit `--idempotency-key`; the CLI never
silently invents one. Run `symbaiex help` for the command groups.

For Ed25519 challenge signing, token refresh, binary artifact downloads, MCP,
and webhook secret creation or rotation, use the TypeScript SDK so callers
control signing, secret storage, output files, and retry policy.

Only the canonical public site origin is supported. `--origin` permits an exact
localhost origin for local development only; do not use it in production.

## Release checks

```sh
bun ci
bun run build
bun run test
bun run pack:check
```

The package requires Bun 1.3 or newer. `0.x` releases may make breaking
changes; production automations should pin an exact package version.
