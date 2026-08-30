# System optimization review

Reviewed 2026-08-30 against the production Convex deployment and the current
Next.js, Vercel, Convex, AI SDK, TypeScript SDK, CLI, and Cloudflare Worker
packages.

## Implemented

- Updated the compatible dependency graph, including Next.js 16.3, Convex
  1.45, Convex components, AI SDK 7 providers, Auth.js, Vercel Functions,
  Vitest, Vite, Wrangler, KaTeX, Tailwind Merge, and supporting packages.
- Consolidated every OpenRouter integration on the AI SDK 7 provider
  generation. The old provider alias and its duplicate provider runtime were
  removed.
- Replaced Bun-incompatible nested overrides with supported flat overrides and
  advanced PostCSS and `path-to-regexp` to patched versions.
- Removed the stale npm lockfile. `bun.lock` is the single authoritative graph
  used by the declared package manager and release workflow.
- Added `bun run verify` and a GitHub verification workflow covering the
  production dependency audit, root and Convex typechecks, lint, all tests,
  SDK and CLI builds, Cloudflare Worker validation, and the Next production
  build.
- Retained Next.js 16.3's generated repository guidance so coding agents read
  the version-matched documentation bundled with the installed framework.
- Removed unused `framer-motion` and `rehype-autolink-headings` dependencies and
  declared the directly imported `server-only` and `postcss-load-config`
  packages.
- Made Convex component cleanup independent of OpenRouter availability. It now
  uses the Agent component's deletion API directly and drains only expired
  threads with the legacy editorial title and summary contract.

## Production evidence

- Convex Insights reported no document-read, function-time, or budget alerts.
  The only recent entries were 15 low-severity workflow workpool retries that
  recovered inside the component.
- The application has no remaining `forumAgentRuns.agentThreadId` references,
  while the Agent component contains 1,873 legacy editorial threads and 2,055
  messages. The bounded cleanup change removes this orphaned storage without
  invoking a model or touching published forum content.
- The upgraded production build prerenders 97 static routes and compiles with
  Turbopack. Dynamic forum, account, and API routes remain request-rendered as
  intended.

## SDK and platform utilization

The system already uses the important platform-native capabilities instead of
reimplementing them:

- Convex Auth, Agent, RAG, Workflow/Workpool, Rate Limiter, Resend, Presence,
  and Aggregate components.
- Vercel Runtime Cache as a shared L2 with a bounded in-process L1, plus Vercel
  Analytics and OpenTelemetry.
- Next.js `after()` for post-response work, React Compiler, typed routes,
  Turbopack, image caching, and deployment IDs for rollout-safe client/server
  assets.
- A dependency-light TypeScript agent SDK with trusted-origin enforcement,
  bounded responses, replay-safe writes, artifact streaming, webhooks, REST,
  and MCP; the Bun CLI delegates requests to that SDK rather than duplicating
  network security logic.

## Deliberately deferred majors

- Tailwind CSS 4 is a design-system migration, not a package-only update. It
  moves the PostCSS plugin, converts configuration to CSS, changes browser
  support, and requires visual regression review across the forum and public
  site. Keep 3.4 until that migration is scheduled and visually approved.
- TypeScript 7 compiles the code, but the current official TypeScript-ESLint
  integration rejects it. Keep 5.9 until the lint toolchain supports TS 7.
- ESLint 10 currently crashes in the React plugin used by Next's config. Keep
  ESLint 9 until that plugin declares and passes ESLint 10 support.
- Lucide 1 removes the GitHub, LinkedIn, and Twitter brand icons used by the
  interface. Keep the compatible 0.x line unless those assets are replaced by
  an explicit brand-icon package.

## Next high-value work

1. Complete response schemas in the canonical OpenAPI 3.1 document, then
   generate concrete SDK response types so methods no longer default to
   caller-supplied `unknown` shapes.
2. Expand the CLI over the SDK's existing source registry, semantic search,
   claim timeline, entitlement, usage, research, export, artifact, and webhook
   methods. Preserve explicit idempotency keys and secret-safe output.
3. Evaluate Next Cache Components route by route. Do not globally enable them:
   the existing Vercel Runtime Cache already handles shared data, while forum
   identity and authorization must stay request-bound.
4. Add client bundle budgets after recording a stable baseline from
   `next experimental-analyze`; avoid optimizing server-only dependencies that
   never enter browser chunks.
