# SYMBiEX Socials Worker

Cloudflare Worker for `socials.symbaiex.com`.

It has two responsibilities:

- Serve the public SYMBiEX social-links page.
- Receive signed Typefully events at `POST /webhooks/typefully`.

The webhook ledger stores only event metadata and payload hashes. It does not
store draft or post text.

## Local development

```bash
bun install
bun run socials:test
bun run socials:typecheck
bun run socials:dev
```

Create `workers/socials/.dev.vars` for local webhook testing:

```dotenv
TYPEFULLY_WEBHOOK_SECRET=replace-with-a-local-test-secret
```

Never commit `.dev.vars` or webhook secrets.

## Cloudflare deployment

The Worker, custom domain, static assets, D1 binding, and observability settings
are declared in `wrangler.jsonc`.

```bash
cd workers/socials
bunx wrangler whoami
bunx wrangler d1 migrations apply symbaiex-socials-events --remote
bunx wrangler secret put TYPEFULLY_WEBHOOK_SECRET
bunx wrangler deploy
```

The Typefully webhook must then be created manually in Typefully under
**Settings → API → Add webhook**:

- URL: `https://socials.symbaiex.com/webhooks/typefully`
- Events: start with `draft.published`, `draft.status_changed`, and
  `draft.tags_changed`
- Secret: store the generated webhook secret in Cloudflare with
  `wrangler secret put`; never place it in this repository

## Operational endpoints

- `GET /health` reports whether D1 and the webhook secret are ready.
- `POST /webhooks/typefully` accepts signed Typefully events only.

Typefully retries non-2xx deliveries. Keep the endpoint healthy and inspect
Worker logs with `bunx wrangler tail` when troubleshooting.

## Event uses

- `draft.created`: audit agent-created drafts without storing their text.
- `draft.planned`: distinguish calendar placeholders from armed schedules.
- `draft.scheduled`: confirm that a planned item is now queued to publish.
- `draft.published`: notify downstream systems and schedule analytics checks.
- `draft.status_changed`: detect unexpected transitions and publishing issues.
- `draft.tags_changed`: drive review states such as `needs-review` or `approved`.
- `draft.deleted`: reconcile downstream indexes and pending automation.
