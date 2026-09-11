# SYMBaiEX MCP registry releases

These are remote-only entries for the official MCP Registry, not npm packages.
The `com.symbaiex.www/*` namespace is bound to the canonical `www.symbaiex.com`
host using a dedicated Ed25519 HTTP ownership proof. The apex redirect and
existing GitHub/npm credentials are not changed.

Deploy the card names and `/.well-known/mcp-registry-auth` before publishing.
Run `bun scripts/publish-mcp-registry.mjs --check` to check the live proof,
matching cards, and both MCP handshakes without writing anything externally.

To publish, use `bun scripts/publish-mcp-registry.mjs --publish --key-file
/absolute/private/path/key.pem`. The dedicated key must have owner-only file
permissions. Keep it outside the repository, backups of public source, shell
arguments, and logs. The script reads it in-process and retains the short-lived
registry credential only in memory. It does not touch shared publisher login
files. Never reuse agent, WorkOS, or Convex Auth keys for this purpose.

Versions are immutable: check the registry before retrying an uncertain publish;
do not bump versions merely to repeat a successful release. A new version must
match the corresponding served card. The script verifies each published record
through the public registry API after publication.

The experimental Server Card format remains separate from the registry format.
Its upstream schema currently requires a URL which returns 404; keep the required
identifier until upstream fixes hosting. The authoritative schema source is
[modelcontextprotocol/ext-server-card](https://github.com/modelcontextprotocol/ext-server-card/blob/main/schema.json).
Do not replace it with the structurally different registry schema or claim it is
an accepted core MCP extension.

References: [remote servers](https://modelcontextprotocol.io/registry/remote-servers),
[domain authentication](https://modelcontextprotocol.io/registry/authentication).
