# Social-ops blog publishing pipeline

`scripts/symbaiex-blog-publisher.mjs` is a server-side-only CLI for the authenticated post API. It never accepts a token argument, writes a secret to disk, or sends a write in its default dry-run mode.

## Content document

Provide a JSON object with only the following fields. All required strings are trimmed; the Markdown body itself is retained (apart from CRLF normalization).

```json
{
  "slug": "shipping-safe-social-ops",
  "title": "Shipping safe social operations",
  "excerpt": "A concise introduction for the blog index.",
  "body": "# Shipping safe social operations\n\nMarkdown content goes here.",
  "tags": ["operations", "security"],
  "status": "draft",
  "publishedAt": "2026-08-21T18:00:00.000Z",
  "readingMinutes": 3,
  "featured": false,
  "imageUrl": "https://images.example.com/social-ops.png",
  "imageAlt": "An operations checklist",
  "imageCredit": "Example Studio",
  "inlineImages": [
    {
      "token": "mechanism",
      "path": "../assets/article-mechanism.png",
      "alt": "Diagram of the article's central mechanism",
      "credit": "SYMBiEX editorial system"
    },
    {
      "token": "operating-checklist",
      "path": "../assets/article-checklist.png",
      "alt": "Operational checklist derived from the article",
      "credit": "SYMBiEX editorial system"
    }
  ]
}
```

Place each inline image once in the Markdown body using a standalone token such as `{{inline-image:mechanism}}`. A multi-image document must contain two to eight distinct inline images. Paths are resolved relative to the JSON document; a durable HTTPS `url` may be supplied instead of a local path. During an apply run, the publisher uploads local files to first-party storage and replaces the tokens with ordinary Markdown image blocks. On reconciliation it finds the previously rendered image by exact alt text, verifies its stored SHA-256 digest, and reuses it rather than uploading a duplicate.

Constraints: slugs and inline-image tokens are lowercase letters/digits separated by single hyphens; title/excerpt/body are nonempty and capped at 180/500/100,000 characters; there are at most 12 unique tags (48 characters each); `readingMinutes` is 1–240; `publishedAt` is either an integer epoch-milliseconds value or a strict ISO-8601 timestamp with time and timezone; and image URLs are HTTPS without embedded credentials. Every inline-image token must appear exactly once. Unknown fields are rejected.

## Live-only workflow

All mutations to symbaiex.com publish live. Draft mutations are disabled as a standing operating rule. The default command remains a non-mutating dry run so content can still be validated before it goes public.

Review the normalized summary first. It includes only title, tag count, reading minutes, cover/inline image counts, and result metadata; it intentionally omits the body and every secret:

```sh
bun scripts/symbaiex-blog-publisher.mjs --input ./post.json
```

Publish or reconcile the live post only after review:

```sh
bun scripts/symbaiex-blog-publisher.mjs --input ./post.json --apply-published
```

For a cover stored on disk, pass it through the authenticated image API in the same run:

```sh
bun scripts/symbaiex-blog-publisher.mjs --input ./post.json --image ./cover.png --apply-published --update
```

The publisher accepts PNG, JPEG, GIF, and WebP files up to 8 MiB, uploads them to first-party Convex storage through `/api/admin/upload`, and writes the returned durable URL into the post mutation. On repeat runs it compares the stored SHA-256 digest and reuses an identical Convex image instead of uploading a duplicate. Third-party scheduler/CDN URLs should not be used as blog covers because their host policy or response MIME type may be incompatible with the site's image optimizer.

For the SYMBiEX social-ops workspace, `article-visuals.json` is the visual source of truth. Every staged article must register one compositionally distinct cover plus at least two useful in-body visuals before release. Run `bun scripts/build-article-visuals.mjs`, `bun scripts/apply-article-visuals.mjs --apply`, and `bun scripts/validate-article-visuals.mjs` from `/Users/symbiex/dev/austin/socials`. The validator discovers every staged article JSON, rejects unregistered documents, duplicate file hashes, reused composition IDs or alt text, missing 1600×900 assets, and unsynchronized placeholders. A failed visual preflight keeps the release inert.

The command first `GET`s `/api/admin/posts/{slug}`. A 404 leads to one `POST` to `/api/admin/posts`; a matching post is a no-op; a different post fails until it is deliberately re-run with `--update`, which makes one `PATCH` to `/api/admin/posts/{slug}`. Auth (401/403), server errors, malformed responses, and transport failures fail closed. Mutations are never retried automatically.

Update an existing live post intentionally:

```sh
bun scripts/symbaiex-blog-publisher.mjs --input ./post.json --apply-published --update
```

Every mutating run forces `status: "published"`, even if the input document says `draft`. The legacy `--apply-draft` option is rejected before credentials are resolved or a network request is made. The output is a small JSON record containing mode, slug, action, HTTP status, and a public URL only when the API returns one.

## Credential setup and rotation

Set `SYMBAIEX_ADMIN_TOKEN` in the process environment for CI or an ephemeral shell. On macOS, if it is absent, the CLI looks up the fixed Keychain service/account pair `symbaiex-blog-admin` / `codex-social-ops`:

```sh
security add-generic-password -U -s symbaiex-blog-admin -a codex-social-ops -w
```

Run this command interactively and enter the replacement token only when `security` prompts—do not put it in the command line. Never place a secret in shell history, a JSON document, CLI argument, commit, issue, or log. Rotate by issuing a replacement server token, updating this same Keychain item through the prompt, validating with a dry run, then revoking the old server token. The CLI prefers `SYMBAIEX_ADMIN_TOKEN` when both sources exist.

The canonical production endpoint is `https://www.symbaiex.com/api/admin/posts`. For local development and tests only, `SYMBAIEX_BLOG_API_BASE_URL` may point to `http://localhost/...` (or `127.0.0.1` / `::1`); all other HTTP endpoints are rejected. Requests use a 10-second timeout and reject redirects. Comparison accounts for the API's lowercase tag normalization so an unchanged post remains a no-op.
