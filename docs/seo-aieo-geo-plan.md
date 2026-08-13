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

- Code release commits: `fb2670e`, `ac071ef`, `f292e11`, and `65eea0f`.
- Production deployment: Vercel deployment `dpl_3qymqqU6DZimr4ZavqEK25PcS4zi`,
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

## Wave 0 — baseline and evidence

- [x] Map route ownership, public/private boundaries, Convex references, current
  metadata, Markdown rendering, proxy behavior, sitemap, and tests.
- [x] Record the baseline commit and preserve unrelated dirty paths.
- [ ] Verify primary and forum properties in Google Search Console.
- [ ] Verify Bing Webmaster Tools and enable AI Performance reporting.
- [ ] Record representative URL Inspection and Rich Results Test receipts.
- [ ] Capture a 30-day baseline for indexed URLs, crawl errors, Core Web Vitals,
  search clicks, cited URLs, and conversions.

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
- [ ] Add topic hubs, related links, crawlable archive links, and breadcrumbs;
  avoid thin tag-page expansion.

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
  filenames, meaningful alt text, captions, and crawlable image URLs.
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
