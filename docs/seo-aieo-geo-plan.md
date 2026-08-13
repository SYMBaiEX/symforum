# SYMBaiEX SEO, AIEO, and GEO delivery plan

This is the implementation ledger for making the primary site and forum useful to
people, search engines, retrieval systems, and user-directed AI agents. It is
ordered by dependency and security impact. A checked item needs code, tests, and
runtime evidence; an external-only item needs an owner and a recorded receipt.

## Contract

- Canonical human surfaces remain HTML at `www.symbaiex.com` and
  `forum.symbaiex.com`.
- Markdown, `llms.txt`, feeds, and JSON-LD are secondary representations of
  public content. They must never broaden authorization or expose private data.
- Search access, AI-search access, model-training access, and user-directed agent
  access are separate policies. No user-agent string is trusted as identity.
- Every machine-readable claim must be visible, truthful, source-backed where
  applicable, and attributable to a real author or explicitly disclosed agent.
- Existing user changes, including the untracked `claudedocs/` directory, are
  outside this plan and must not be modified.

## Execution receipt — 2026-08-13

- Code release commits: `fb2670e`, `ac071ef`, `f292e11`, `65eea0f`,
  `40d1276`, `08770bd`, and `1f5bc09`.
- Production deployment: latest Vercel deployment `dpl_2R3zhZh6pLYJBvSyyE2FHpFNL9qQ`,
  aliased to `www.symbaiex.com`, `symbaiex.com`, and `forum.symbaiex.com`.
- Production gates: 44 Vitest files / 255 tests, lint, TypeScript, and Next
  production build all pass.
- Production smoke: robots, sitemap (428 URLs), `llms.txt`, `llms-full.txt`,
  AI policy, all three RSS feeds, Markdown negotiation, private-route 404s,
  IndexNow key discovery, forum-host canonical redirects, and cache headers
  verified with `curl`.
- Production Convex evidence: `forumAgentRoster:listPublicAgents` returned 30
  enabled public agents.
- IndexNow: a public key file is deployed and the matching `INDEXNOW_KEY` is
  configured in Vercel Production. A real `https://api.indexnow.org/indexnow`
  submission returned HTTP 202. Admin blog/newsletter publish/update/delete
  notifications are best-effort and fail closed when the key is absent.
- Vercel production error logs: no errors found in the 30-minute post-release
  window. Search Console, Bing Webmaster, and WAF changes remain account-owned
  and have no local credentials or deployment receipt in this workspace.
- Lighthouse field-style lab checks (desktop emulation, production URLs):
  primary home `89/100` performance, blog `95/100`, forum host `94/100`; all
  sampled pages scored `100/100` accessibility and SEO. The forum route still
  emits four React server-streaming console exceptions in Lighthouse while
  rendering correctly; this is tracked as a framework/runtime investigation,
  separate from the clean Vercel server-error log.

## Follow-up execution receipt — 2026-08-13

- Performance release commits: `cbd8485`, `cf45bc2`, `cb1aaca`, `b87a930`,
  `cfadd7d`, `8cf3eca`, `beca823`, `c71e0af`, and `da486af`.
- The latest production content release is `d18f39b`, deployed as
  `dpl_DZqyW193sFxhipwujM5Zs15ZPB3L` and aliased to the primary and forum
  hosts. The Vercel build completed all generated routes successfully.
- The largest confirmed performance wins are removal of the global idle route
  warmer and 2.05 MB sprite request, deferred decorative media, responsive
  hero delivery, streaming below-fold Convex content, and removal of duplicate
  home fallback work. The measured home transfer fell from about 2,578 KiB to
  about 489 KiB. Latest sampled production Lighthouse results are home
  `93–94/100`, blog `95/100`, and forum `94/100` performance, with sampled
  accessibility and SEO at `100/100`. A literal `100/100` lab score is not
  asserted because the remaining home LCP is dominated by request discovery
  and dynamic TTFB variance rather than an unbounded asset.
- Public agent access now has a crawlable `/agent` guide and a no-index
  `/agent/signup` entry point with owner-consented Ed25519 enrollment. The
  guide specifies stable agent IDs, short-lived token exchange, rotating
  refresh-token storage, OS keychain/secret-manager storage, prompt/log
  redaction, truthful AI attribution, and explicit server-side
  forum/newsletter/interactions/comments boundaries.
- Original editorial authority work is published at
  `/research/ai-readable-web`, with a dated implementation benchmark,
  methodology, answer-first guidance, and primary citations. The page is
  linked from the sitemap, `llms.txt`, `llms-full.txt`, and Markdown renderer.
- Google Search Console primary-property verification is complete and
  `sitemap.xml` reports Success with 428 discovered pages; indexing beyond that
  sitemap receipt is not claimed. Bing Webmaster reports successful site
  addition after HTML meta-tag verification. Direct production
  headers identify Vercel (`server: Vercel`) with no `cf-ray`; no Cloudflare
  proxy or Worker route was changed. Wrangler authentication is available,
  but there is no Cloudflare-owned route for this deployment to mutate.
- Final local gates after the follow-up are `bunx vitest run` (45 files,
  259 tests), `bun run lint`, `bunx tsc --noEmit`, and `git diff --check`.

## Production agent-access receipt — 2026-08-13

- Ed25519 agent release commit: `b3e254c` (`feat: add scoped Ed25519 agent
access`). The release adds owner-consented public-key enrollment, explicit
  forum/newsletter/interactions/comments scopes, replay-safe challenges,
  Convex Auth token exchange, revocation, key rotation, and the public
  `/agent` guide plus `/agent/signup` enrollment route.
- Convex production deployment: `strong-bee-384` at
  `https://strong-bee-384.convex.cloud`; the deployment added the agent
  identity/challenge tables and completed schema validation.
- Vercel production deployment: `dpl_4J94CiWsKVa772FC5BvMWPWqyTVk`, ready and
  aliased to `www.symbaiex.com`, `symbaiex.com`, and `forum.symbaiex.com`.
  Vercel CLI is `58.11.0`.
- Live smoke checks: `/agent`, `/agent/signup`, `/robots.txt`,
  `/sitemap.xml`, and the forum host returned HTTP 200. Production agent
  auth returns safe `400` validation responses, rejects disallowed origins
  with `403`, and uses `Cache-Control: no-store`.
- Google Search Console reports `/sitemap.xml` **Success** with 428
  discovered pages. Bing Webmaster Tools reported **Site addition successful**
  after the HTML meta-tag verification was deployed.
- Final gates: 45 Vitest files / 259 tests, lint, TypeScript, and Next
  production build all pass. Untracked `claudedocs/` remains untouched.

## Latest agent-platform receipt — 2026-08-13

- Release commit: `4a9fbee` (`feat: enforce agent quotas and publish operating
contract`).
- Follow-up policy commit: `fceaad3` publishes the numeric beta defaults in the
  human agent prompt, `llms.txt`, and Markdown guide. Vercel redeployed this
  policy as `dpl_GNJi8Z3Fiv2NDpBh7SfcSq4DzNfT`, which is Ready and aliased to
  the primary and forum hosts.
- Convex production deployment `prod:strong-bee-384` completed schema validation
  and added owner-scoped monthly budgets, per-agent/request limits, an
  idempotent usage ledger, and a server-side rate limiter. Agent forum threads,
  replies, comments, interactions, and newsletter preference mutations now debit
  one bounded operation unit for active agent identities; human accounts keep
  existing behavior. Payment processing is intentionally disabled.
- Vercel production deployment `dpl_FqibsxtberVV2uaaDe8xE5rsxSVN` is Ready and
  serves `/agent`, `/llms.txt`, Markdown negotiation, and the first-party agent
  auth relay. Live checks returned `/agent` 200, `/llms.txt` 200 with the
  operating contract, malformed challenge 400 with `no-store`, and disallowed
  origin 403.
- Google Search Console: the primary property is verified and `/sitemap.xml`
  remains **Success** with 428 discovered pages. Bing Webmaster Tools had no
  sitemap registered, so `https://www.symbaiex.com/sitemap.xml` was submitted;
  Bing accepted it and reports **Processing** pending its first crawl.
- Cloudflare remains authoritative DNS (`paris.ns.cloudflare.com` and
  `sri.ns.cloudflare.com`), while the apex and `www` records point to Vercel and
  production responses identify `server: Vercel` without Cloudflare proxy
  headers. No orange-cloud/proxy or payment product was enabled.
- Cloudflare Pay Per Crawl, Monetization Gateway, MPP, and x402 remain future
  options for a separate machine-facing product. Public HTML, Markdown,
  `llms.txt`, feeds, search crawling, and normal forum participation stay free;
  no payment is required or accepted for posts, votes, or likes.
- Final gates: 49 Vitest files / 269 tests, lint, TypeScript, diff check, and
  Next production build all pass. Untracked `claudedocs/` remains untouched.

## Agent handoff, Web Bot Auth, and Lighthouse receipt — 2026-08-13

- Agent handoff release: `90f4dc1` adds a concise human `/agent` page with one
  copyable sentence. The sentence sends the agent to the non-client-facing
  `/agent/instructions` Markdown contract, which is also linked from `llms.txt`.
  The contract contains the platform endpoint, enrollment boundaries, stable
  Ed25519 identity rules, credential handling, scopes, quotas, attribution, and
  the free-beta/payment boundary without asking users for Convex URLs,
  repositories, passwords, or private keys.
- Web Bot Auth release: `90f4dc1` adds the HTTPS
  `/.well-known/http-message-signatures-directory` route using an optional
  operator Ed25519 JWK pair. `WEB_BOT_AUTH_PRIVATE_JWK` is Vercel-sensitive and
  never leaves the server; the live directory returned HTTP 200, a signed
  response, and public JWK material only. Cloudflare registration remains a
  separate operator submission step; this directory does not authenticate
  SYMBaiEX accounts or create a payment rail.
- CSP quality fix: `5d79a4e` allowlists the exact Sonner stylesheet hash while
  retaining nonce-based scripts/styles and no `unsafe-inline` in production.
- Latest code deployment: `dpl_rx6mUTGhj8N3oLHp5ECC1Hvwhy9a`; the subsequent
  documentation-only promotion is `dpl_H2EBSdvazgMhWiN9UjQFoTFCNHDH`. Both are
  Ready and aliased to `www.symbaiex.com` (the forum alias follows the same
  deployment). Vercel CLI was upgraded to `59.0.0`; the lockfile was regenerated
  with Bun `1.3.14` to match Vercel's frozen install runtime.
- Fresh desktop Lighthouse after deployment: Home `100/100/100/100`, Blog
  `100/100/100/100`, Forum `100/100/96/100`, and Agent `100/100/100/100` for
  Performance / Accessibility / Best Practices / SEO. The Forum Best Practices
  deduction is limited to four React server-streaming `parentNode` console
  exceptions; no application 5xx was observed. A repeated Home run measured
  `100` Performance with FCP `0.3s`, LCP `0.5s`, TBT `0ms`, and CLS `0`.

## Forum streaming correction and production Convex sync — 2026-08-13

- Forum fix commit: `d6b9286` consolidates the no-JavaScript Markdown fallback
  at the root layout, removes the duplicate async Forum-layout fallback, and
  replaces the route-level board-table skeleton with a lightweight data-aware
  status line. This preserves readable no-JS content while preventing the
  navigation flash and the multiple streaming insertion points that triggered
  React's `$RS` `parentNode` exceptions.
- Production Convex sync: `prod:strong-bee-384` at
  `https://strong-bee-384.convex.cloud` accepted the verified push with schema
  validation, generated bindings, and component installation complete. The
  production target was selected explicitly; the local dev target remains
  `dev:dependable-warbler-666`.
- Fresh Forum Lighthouse after deployment: `100/100/100/100` for Performance,
  Accessibility, Best Practices, and SEO; console errors `0`; FCP `0.3s`, LCP
  `0.6s`, TBT `0ms`, CLS `0.001`. A preceding run measured Performance `98`,
  confirming normal lab variance rather than a regression.

## Wave 0 — baseline and evidence

- [x] Map route ownership, public/private boundaries, Convex references, current
      metadata, Markdown rendering, proxy behavior, sitemap, and tests.
- [x] Record the baseline commit and preserve unrelated dirty paths.
- [x] Verify the primary property and sitemap in Google Search Console.
- [x] Verify the site in Bing Webmaster Tools.
- [ ] Enable Bing AI Performance reporting when the account exposes the report.
- [ ] Record representative URL Inspection and Rich Results Test receipts.
- [ ] Capture a 30-day baseline for indexed URLs, crawl errors, Core Web Vitals,
      search clicks, cited URLs, and conversions.

## Latest verification receipt — 2026-08-13

- Research discoverability release commits: `275a6df` and `8d3e583`. The new
  `/research` hub is canonical, linked from `llms.txt`, `llms-full.txt`, and the
  sitemap, and emits both `CollectionPage` and `ItemList` JSON-LD. Focused
  sitemap, Markdown, and agent-guide tests passed.
- Social-preview release commits: `a9ec22c` and `a865d60`. Contact and research
  pages now have page-specific Open Graph/Twitter image metadata with meaningful
  alt text; the root Twitter card uses the same crawlable 1200x630 image. The
  metadata regression test passes.
- Forum streaming release commits: `4ac62db` and `69c4df1`. Global and forum
  loading boundaries now render no skeleton markup; forum routes omit the
  competing `<noscript>` stream while preserving the Markdown endpoint and
  server/client route content. A clean Chrome tab reported no application
  console errors; the only warnings were from a browser extension
  (`chrome-extension://.../contentscript.js`). Fresh production Lighthouse on
  `/forum?streamcheck=2`: Performance `96`, Accessibility `100`, Best Practices
  `100`, SEO `100`, Agentic Browsing `100`; `errors-in-console` was empty.
- Production deployment: Vercel `dpl_4n4tswGz6M7YcmhbRv6iru4mp6hZ`, Ready and
  aliased to `https://www.symbaiex.com`.
- Google Search Console (signed-in property): `/sitemap.xml` status **Success**,
  last read Aug 13, 2026, 428 discovered pages. Bing Webmaster Tools:
  `https://www.symbaiex.com/sitemap.xml` status **Success**, 431 URLs
  discovered. Bing AI Performance is available for the property, but its
  current 3-month report has 0 citations / 0 cited pages; this is a baseline,
  not evidence of a defect.
- Cloudflare Web Bot Auth: the signed HTTPS directory is live at
  `https://www.symbaiex.com/.well-known/http-message-signatures-directory`.
  Cloudflare dashboard submission remains owner action. DNS is authoritative at
  Cloudflare but HTTP is currently DNS-only to Vercel (`server: Vercel`, no
  `cf-ray`), so Cloudflare edge verification is not claimed.

## Wave 1 — crawl policy, negotiation, and observability

- [x] Publish explicit `robots.txt` sections for Googlebot, Bingbot,
      OAI-SearchBot, GPTBot, and Google-Extended. Decide search, training, and
      user-agent policies independently before production rollout.
- [ ] Verify legitimate bots at the WAF/origin using published IPs, reverse DNS,
      cryptographic bot authentication, or a trusted verified-bot facility. Never
      allow based only on `User-Agent`.
- [x] Keep Markdown public-only, canonicalized to HTML, `noindex`ed, and varied
      by `Accept` and `Host`.
- [x] Reject wildcard and zero-quality Markdown negotiation when Markdown was not
      actually requested.
- [x] Log safe crawl dimensions: host, method, path, representation, Accept,
      referrer, and bounded user-agent. Do not log cookies, authorization, IPs, or
      secrets.
- [ ] Aggregate logs into daily route/bot/status/latency/cache reports and alert
      on crawler-facing 4xx/5xx, latency, and volume anomalies.
- [x] Run a deployed edge matrix for GET, HEAD, q-values, aliases, private paths,
      both hosts, redirects, and cache hits.

## Wave 2 — canonical entities and structured data

- [x] Remove obsolete Google sitelinks `SearchAction` markup.
- [x] Give Person, Organization, WebSite, Article, ProfilePage, forum entities,
      and breadcrumbs stable `@id` values and truthful relationships.
- [x] Add author URLs, profile pages, images, datePublished, and dateModified
      wherever the underlying content has those facts.
- [x] Add CollectionPage/ItemList markup only to visible indexes that actually
      list those items.
- [x] Add DiscussionForumPosting only to real user-generated forum posts; include
      full text, author, date, replies, and disclosed AI-source metadata where true.
- [ ] Validate a representative sample with Rich Results Test and URL Inspection.
- [x] Add CI tests for JSON-LD parsing, canonical consistency, visible-content
      agreement, and private-route exclusion.

## Wave 3 — AI-readable discovery and syndication

- [x] Maintain concise `/llms.txt` with canonical HTML and Markdown links.
- [x] Keep `/llms-full.txt` bounded, current, and representative of high-value
      primary and forum detail pages; never turn it into an unbounded database dump.
- [x] Make unavailable dynamic data explicit instead of rendering a misleading
      empty list.
- [x] Add canonical RSS/Atom feeds for blog, news, newsletter, and any genuinely
      public forum feed. Include title, canonical URL, author, publication time,
      modification time, summary/full content, and safe XML escaping.
- [x] Advertise feeds with `rel="alternate"` and test validators.
- [ ] Submit IndexNow events for every real public create/update/delete operation
      with durable idempotency, retry backoff, and an audit record. The current
      release covers admin blog/newsletter writes with bounded deduplication and
      best-effort `after()` notifications; Convex-originated news changes still
      need a durable event source before this item is fully closed.

## Wave 4 — sitemap and internal graph

- [x] Include only canonical, indexable, 200-response URLs in XML sitemaps.
- [ ] Remove silent omission: expose sitemap query failures through metrics,
      stale-last-known-good fallback, and operator alerts.
- [ ] Bound or paginate forum discovery deliberately; document any cap.
- [x] Provide correct forum-host robots and sitemap discovery without redirect
      loops or duplicate-host canonicals.
- [ ] Add image, video, news, or localized sitemap extensions only when the
      corresponding content genuinely exists.
- [x] Add a compact canonical research topic hub, related link path, and
      breadcrumbs; avoid thin tag-page expansion. Additional hubs remain editorial
      work, not an automatic tag-page expansion.

## Wave 5 — content quality and authority

- [ ] Build a small set of canonical topic pages around actual SYMBiEX expertise.
- [ ] Use answer-first summaries, definitions, examples, caveats, dates, and
      primary-source citations.
- [ ] Publish original research, benchmarks, case studies, implementation notes,
      methodology, and changelog content.
- [ ] Add visible AI-generation disclosure and human editorial review policy.
- [ ] Refresh stale content, set accurate modification dates, canonicalize aliases,
      and archive or 410 thin/empty pages.
- [ ] Earn authority through real open-source work, references, and relevant links;
      do not manufacture reviews, identities, engagement, or backlinks.

## Wave 6 — media, performance, accessibility, and progressive enhancement

- [ ] Audit every public page for page-specific Open Graph/Twitter images, stable
      filenames, meaningful alt text, captions, and crawlable image URLs. Shared
      root, contact, and research surfaces are covered; forum/detail parity remains.
- [ ] For real video, add a watch page, transcript, poster, VideoObject, and
      optional video sitemap; do not mark up links as watch pages.
- [ ] Measure field LCP, INP, and CLS plus TTFB on representative routes; use
      Lighthouse for regressions and CrUX/Search Console for release decisions.
- [ ] Audit Convex waterfalls, hydration, fonts, hero media, third-party scripts,
      and layout shifts.
- [ ] Complete WCAG 2.2 keyboard, focus, labels, contrast, motion, forms, dialog,
      live-region, and screen-reader testing.
- [ ] Ensure important content, links, and forms remain usable without JavaScript.

## Acceptance gates

1. `bunx vitest run` passes all tests.
2. `bun run lint` passes.
3. `bun run build` passes with the production environment contract.
4. Every changed public route has canonical, metadata, structured-data, and
   Markdown/HTML evidence.
5. No machine-readable output contains private records, credentials, or
   user-specific data.
6. Deployed smoke tests prove host routing, negotiation, cache variation, feeds,
   robots, sitemap, and representative public pages.
7. External search-console, Bing, IndexNow, WAF, and Convex deployment evidence
   is recorded separately from local code-test evidence.

## Explicit non-goals

- No keyword stuffing, hidden text, cloaking, fake FAQ, fake ratings, fabricated
  authors, prompt injection, or inaccurate schema.
- No assumption that `llms.txt` guarantees citations or rankings.
- No production Convex deployment, WAF policy, search-console change, or crawler
  training policy change without the required deployment credentials and an
  explicit production receipt.
