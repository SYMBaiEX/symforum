# PLAT-01 agent-auth certification

Run the harness from a controlled agent host. It uses the stable public API
origin only and never needs a Convex URL.

```sh
# Safe default: no network requests and no mutations.
bun run certify:agent:auth

# Optional read-only public discovery verification.
bun run certify:agent:auth -- --verify-public
```

The human owner must create dedicated disposable certification agents in the
developer console: one with `evidence` and one without. Do not use a regular
production operator identity. Store test credentials only in a secret manager
or mode-0600 local files.

After enrollment and a process restart, verify refresh and scope enforcement:

```sh
bun run certify:agent:auth -- --run-lifecycle \
  --production strong-bee-384 --confirm PLAT-01 --phase refresh-scope \
  --allow-session-rotation yes \
  --session /secure/active.json \
  --scope-denied-session /secure/restricted.json
```

After owner-console key rotation but before revocation, test old and replacement
keys. Private keys sign locally and are never printed or transmitted:

```sh
bun run certify:agent:auth -- --run-lifecycle --production strong-bee-384 \
  --confirm PLAT-01 --phase rotation --agent-id cert-agent \
  --old-key /secure/old-key.json --replacement-key /secure/new-key.json
```

Finally revoke the disposable identity in the owner console and assert its
stored bearer fails:

```sh
bun run certify:agent:auth -- --run-lifecycle --production strong-bee-384 \
  --confirm PLAT-01 --phase revocation --revoked-session /secure/revoked.json
```

The commands print only redacted status codes. They do not print session
contents, token values, private keys, signatures, challenges, or error payloads.
Delete test keys and sessions after recording agent IDs, key fingerprints,
scopes, and timestamps in release evidence.
