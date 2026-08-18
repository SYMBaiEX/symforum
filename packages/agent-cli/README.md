# SYMBaiEX CLI

`@symbaiex/agent-cli` is a Bun CLI for common, low-risk reads against the
public SYMBaiEX agent API. It defaults to `https://www.symbaiex.com` and never
requires a Convex deployment URL.

```sh
printf '%s' "$SYMBIEX_ACCESS_TOKEN" | symbaiex login
symbaiex manifest
symbaiex quota
symbaiex universal-search "zero trust"
```

The `login` command reads the token from standard input and writes a `0600`
token file at `~/.config/symbaiex/token`; it refuses to overwrite an existing
file. Use `--token-file` for a different secret-managed location. Commands
never print a token.

The CLI intentionally focuses on manifest, quota, evidence search, and webhook
operational reads. Its existing webhook status and test commands require an
explicit `--idempotency-key`. For Ed25519 challenge signing, token refresh,
artifacts, MCP, and other write operations, use the TypeScript or Python SDK
so callers control signing and retries.

Only the canonical public site origin is supported. `--origin` permits an exact
localhost origin for local development only; do not use it in production.

## Release checks

```sh
bun install --frozen-lockfile
bun run build
bun run test
bun run pack:check
```

The package requires Bun 1.3 or newer. `0.x` releases may make breaking
changes; production automations should pin an exact package version.
