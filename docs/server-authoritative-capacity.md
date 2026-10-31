# Server-authoritative reads and capacity

This is a source-backed operating contract, not a production load-test certificate.
The intended workload is hundreds of concurrent forum visitors, with shared token
data and separately authorized private wallet actions. No provider subscription,
budget, schedule, fee, or uncertain-operation policy is changed by this document.
The improvements below describe the reviewed change set, not a claim that its
backend and website rollouts have already completed.

## Ownership of work

| Work                               | Authority and reuse boundary                                                                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public chart and market data       | Convex owns exact-mint/interval cache keys, atomic refresh leases, upstream validation, admission and retry deadlines. The website serves that result; a browser does not call provider RPC to fill missing data.                                     |
| Token search                       | The server verifies linked-wallet ownership before reading a shared, public-token-only search cache. This change adds exact, unexpired lease fencing to both success and failure completion.                                                          |
| Forum reads                        | Convex applies visibility and account checks. Equivalent public requests should use equivalent arguments; timestamps that do not affect results must not create unique cache keys per visitor. Authenticated results remain scoped to their identity. |
| Private balances                   | Server ownership checks and wallet/selection-bound leases precede I/O. A cached balance is a dated observation, not authorization to spend or a guarantee of spendable funds.                                                                         |
| Quotes and transaction preparation | Server-owned, wallet-bound requests; recheck configuration, expiry, token restrictions and simulation. Never place private quotes or prepared transactions in a public cache.                                                                         |
| Signing and submission             | The user's wallet retains keys and signs locally. The server validates the exact signed transaction and records its signature before a single relay claim. An uncertain result is held, not automatically sent again.                                 |

The client still renders charts, handles navigation and asks the user's wallet for
explicit approval. Moving those tasks to a server would not make ownership safer;
the server must instead reject unauthorized, altered, expired or duplicate work.

## Existing scaling controls

- `convex/forumMarketData.ts` uses an indexed, durable cache shared across sites
  and server instances. Its claim transaction admits at most one refresh for a
  key. Fresh hits, pending requests and future retry deadlines do not reserve new
  upstream units. A late or expired writer cannot replace a newer chart lease.
- `lib/terminal-market-route.ts` validates the returned mint, interval, pinned
  pool and original timestamp. Fresh CDN lifetime is bounded by remaining
  freshness; stale/failure responses are not cached as newly fresh data.
- `convex/forumTerminalRefresh.ts` batches up to thirty eligible mints into one
  public quote request, with deterministic source-platform interleaving and a
  global server-owned refresh window.
- `convex/forumTerminalData.ts` protects balance reads with linked ownership,
  wallet/selection isolation and a sixty-second server reuse window. The UI's
  visibility/online gates reduce demand but do not replace server admission.
- `convex/forumSwaps.ts` coalesces duplicate read-only quote requests by owner,
  wallet and exact inputs. Prepared or sent transactions are not reusable quotes.
- `convex/forumSwapSubmission.ts` binds signatures to the approved message and
  permits one relay claim. No retry mechanism may bypass this financial boundary.
- The main Feed paginates indexed digests/canonical rows with a bounded byte
  budget and applies visibility checks before returning them. Existing limits
  are not enlarged to fill a sparse or filtered page.

## Improvements in this change

1. Fence token-search completion by its exact current lease, including negative
   results. An old response must neither overwrite a newer cache entry nor be
   returned as the result of a newer search attempt. This is cache correctness,
   not a new retry or provider allowance.
2. Omit the unused clock argument from signed-out Feed requests. Bucket recent
   activity's mount-time argument by UTC day, the precision already used by that
   server query. Keep authenticated Feed mute-expiry timing and existing request
   cadence unchanged. This permits shared query reuse; it does not share private
   account results or cache them in a public browser store.
3. Use the shared five-minute chart freshness policy instead of an independent
   three-minute cutoff. When an indexed sample is genuinely absent, a retained
   exact-mint chart snapshot may supply explicitly stale, originally dated
   values within the existing twenty-four-hour retention policy. Latest nulls,
   cleared values and expiry still win. This does not manufacture one-hour
   change, infer spot price from a candle or turn historical data into live data.

## Baseline capacity before provider enforcement

Concurrency and daily coverage are different constraints. Sharing a cached
instrument with hundreds of viewers is not the same workload as fetching hundreds
of different wallets or instruments for the first time.

At source baseline `b3954d7e`, the terminal allowance is **100 reserved units/day**, shared by public
charts, sampled market refreshes, private balances and risk reads. The broader
commerce network allowance is **1,000/day**. Reservations are not a measurement
of a provider bill; failed or uncertain work is not silently refunded.

| Isolated workload, before other consumption                   | Current accounting consequence                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Hundreds of viewers, same chart key, one cold refresh         | One admitted two-request refresh, two reserved units; subsequent fresh hits reuse it.                                                        |
| One chart refreshing every five minutes for twenty-four hours | 288 refresh windows × two units = 576 units. This cannot fit the current terminal allowance even before other features.                      |
| A cold private balance read                                   | Three to five units depending on the selected mint; at most 20–33 such reads fit 100 units before other terminal consumption.                |
| Many distinct cold instruments or wallets                     | Admission must return an honest busy, unavailable or stale state when the unchanged allowance is exhausted. Viewer count cannot override it. |

These are source-derived ceilings, not forecasts or measured production demand.
No claim is made that the current free allowance supports continuous fresh data
for hundreds of distinct active traders. A paid plan would not automatically
change these application-level gates either.

Provider-specific subquotas can deny work before either global allowance runs
out. For example, the conditional Solana Tracker candle path also reserves its
existing provider allowance through `tokenAlphaData.reserveApiRequest`; available
terminal units alone do not guarantee an admitted candle request.

## Approved read policy and activation prerequisite

`lib/forum-read-policy.ts` defines the approved application ceilings below.
The policy-only change does **not** activate them: the baseline limits must not
be lifted until every relevant provider call is subject to shared, atomic
admission. Importing constants is not enforcement or evidence of a live rollout.

| Application ceiling          | Approved value                                                    | Required scope                                                              |
| ---------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Terminal reserved units      | 6,000/day                                                         | Charts, Markets, balances and risk reads together                           |
| Commerce network units       | 20,000/day                                                        | Shared ceiling; reservations are not provider billing credits               |
| Markets batches              | 144/day                                                           | Existing ten-minute minimum spacing and thirty-mint batch stay unchanged    |
| Helius credits               | 10,000/day and 300,000 rolling 32 days                            | Both weighted limits must pass; all known users of the configured account   |
| Helius request window        | 5 per strict rolling second                                       | Not five per caller or five at each fixed-second boundary                   |
| Jupiter main/keyless windows | 50/25 per rolling minute                                          | Preserve conservative existing pacing across the shared organisation/egress |
| DEX Screener window          | 60 per strict rolling minute                                      | All known pair/token/batch callers together                                 |
| GeckoTerminal window         | 8 per strict rolling minute                                       | All known pool, candle and trade callers together                           |
| Tracker                      | 70/day; 12 candles/day; 10 enrichments/day; 2,300 rolling 32 days | Unchanged shared provider allowance, including scheduled rankings           |

Admission must count each actual request before transport, including failures
and bounded alternate routes. JSON-RPC batches cost the sum of their allowed
methods, not one unit merely because they use one HTTP request. Unknown methods
must fail closed, not default to one credit. A cache hit must not consume new
upstream units. Denial must not create a new provider fallback or retry loop.

Integration must use the existing rate-limiter component, not a parallel custom
quota counter. The planned conservative enforcement checks overlapping component
buckets covering twice each short window, and both current and previous buckets.
Credit accounting uses thirty-three rotating UTC day buckets with a thirty-three-day
component period, conservatively covering the intended thirty-two-day period.
This overcoverage can deny requests sooner and yield lower sustained throughput
than the nominal limits. A strict rolling **ceiling** does not mean exact sliding
window utilization. These are integration requirements, not enforcement activated
by the policy-only module.

The explicit RPC cost allowlist covers the existing standard methods:
`getAccountInfo`, `getBalance`, `getBlockHeight`, `getFeeForMessage`,
`getFirstAvailableBlock`, `getGenesisHash`, `getLatestBlockhash`,
`getMultipleAccounts`, `getSignatureStatuses`, `getSignaturesForAddress`,
`getTokenAccountsByOwner`, `getTransaction`, `isBlockhashValid`,
`simulateTransaction` and `sendTransaction`. Each is one standard RPC credit.
The last entry is metering metadata only: it does not authorize submission,
change the one-shot signature gate or permit replay. No RPC is called by the
pure policy tests.

No provider plan, key, remaining balance, billing-cycle position or external
application consumption was inspected. The difference between Helius's advertised
one-million-credit free allocation and the 300,000-credit application ceiling is
**unallocated headroom, not verified available credits**. Same-account callers
outside the ledger can consume it. A newly started ledger cannot establish how
much an already-running account has spent. No automatic upgrade, paid overage,
additional API key or account rotation is authorized.

## Source-checked provider limits (2026-10-31)

- Helius Free advertises one million monthly credits and ten RPC requests per
  second. Standard RPC, including `getTokenAccountsByOwner`, `getTransaction`
  and `getSignaturesForAddress`, costs one credit. Separately priced products
  include `getProgramAccounts` and DAS at ten, enhanced REST transaction parsing
  at one hundred, and Wallet API at one hundred. These unused endpoints are not
  implicitly added to the allowlist. WebSocket traffic also consumes credits:
  two per 0.1 MB of uncompressed data. [Credits](https://www.helius.dev/docs/billing/credits),
  [rate limits](https://www.helius.dev/docs/billing/rate-limits).
- Jupiter Free permits sixty requests per sixty-second sliding window across
  an organisation, not per key or team; keyless permits thirty. Token search,
  order and build share the main bucket. Managed `/swap/v2/execute` has a separate
  fifty-RPS Free bucket, but this policy does not widen any financial flow to
  exploit it. Free credits are unlimited, not request rates.
  [Rate limits](https://developers.jup.ag/docs/portal/rate-limits),
  [plans and endpoint credits](https://developers.jup.ag/docs/portal/plans).
- DEX Screener documents three hundred requests/minute for the pair/token
  endpoints used here, with up to thirty token addresses in one batch request.
  That does not establish an unlimited monthly or availability guarantee.
  [API reference](https://docs.dexscreener.com/api/reference).
- GeckoTerminal's official support article, updated October 2, says thirty
  calls/minute; its developer landing page says ten. The approved eight-request
  rolling window stays below the lower published figure. This keyless public
  service is **not** CoinGecko Demo, which currently advertises one hundred/minute
  and ten thousand/month. No Demo key or alternate transport is introduced.
  [GeckoTerminal support](https://support.coingecko.com/articles/6867086195-does-geckoterminal-have-an-api),
  [developer page](https://www.geckoterminal.com/dex-api),
  [CoinGecko Demo pricing](https://www.coingecko.com/en/api/pricing).
- Tracker Free advertises 2,500 requests/month and three requests/second, not an
  annual free allocation. Existing stricter daily, enrichment, candle and rolling
  application limits remain unchanged. [Tracker pricing](https://www.solanatracker.io/data-api).

## Capacity arithmetic and known callers outside the baseline ledger

| Isolated daily workload                                        | Reserved terminal units |
| -------------------------------------------------------------- | ----------------------: |
| 200 cold wallets, worst-case five calls each                   |                   1,000 |
| Five shared chart intervals, each refreshed every five minutes |     5 × 288 × 2 = 2,880 |
| One shared Markets batch every ten minutes                     |                     144 |
| Subtotal                                                       |                   4,024 |
| Additional 200 one-call risk checks                            |                     200 |
| Total, before other activity                                   |                   4,224 |

This arithmetic fits the proposed 6,000-unit terminal ceiling, not necessarily
every provider allowance. Hundreds of concurrent readers of a shared key are
different from hundreds of cold instruments or active trading wallets.

The baseline also has callers outside the commerce counters that must be
accounted for before claiming provider-global enforcement:

- `convex/telegramTradeFeedPoll.ts` can make one pool-discovery request plus up
  to six Gecko trade requests per admitted minute: up to 10,080/day if enabled.
  Its cron, delivery rules, feature gates and uncertainty handling stay unchanged.
- `apps/platform/app/api/token/symf/market/route.ts` directly fetches one DEX and
  one Gecko response with sixty-second revalidation. One warm cache lane would
  use up to 2,880 requests/day; revalidation is not a global cross-region lease.
- `workers/broadcast/worker.mjs` and `apps/forum/public/broadcast/token.js` use
  a three-minute DEX lane (480 primary requests/day), with one bounded eligible
  alternate request. The worker's different egress does not make its usage free
  or create permission to bypass a shared provider allowance.
- The configured RPC is used through both `commerceRpc` and `swapRpc`, including
  terminal, holder-proof, research, promotion, preparation, receipt, recovery and
  reconciliation paths. Existing ownership and financial gates precede network
  work; accounting must not bypass or replay them.

The maximum Telegram Gecko demand plus one warm overview lane plus five chart
intervals is 10,080 + 1,440 + 1,440 = **12,960 Gecko requests/day**, exceeding
the eight/minute policy's 11,520/day theoretical maximum. Global admission must
therefore sometimes return busy/stale/unavailable; no continuous-freshness promise
is justified. The combined example uses 17,664–18,144 network units/day when
overview, Telegram and broadcast calls are included, leaving limited room within
20,000 for other workflows. These are demand calculations, not observed usage.

No Helius streaming consumer was identified in this repository; consumption by
external deployments, keys, accounts or streams remains unverified. All known
same-provider paths need a shared authority, or an explicitly bounded separate
allocation. New constants alone cannot close these accounting holes.

The model budget remains two/day, the fee remains fifty basis points, and agent
schedules, Tracker allowances, freshness/retention rules, holds, receipt recovery,
signing and submission authority are unchanged by this policy-only change.

## Remaining work before a high-activity trading launch

- Share the repeated exact-mint DEX pair response across chart intervals and
  market overview requests. Preserve a separate original market observation
  timestamp: reusing pool/stats data must not relabel it with a new candle time.
- Review provider-specific pacing and workload allocation together before any
  quota change. A global daily counter alone does not enforce each upstream's
  short-window policy. Do not add an unmetered fallback or increase provider,
  application or free-tier limits implicitly.
- Reduce the bounded recent-activity scan if live profiling shows it is hot.
  It currently considers up to 500 active and 500 locked digests before some
  per-viewer work. Preserve unread, visibility and pagination semantics rather
  than replacing it with an incomplete first page.
- Consider suspending pure display subscriptions in hidden terminal panes;
  retain protected order/receipt controllers and attention-producing state.
- Benchmark authentication separately with mocked same-IP, distinct-IP,
  missing/multi-hop-header and concurrent-session requests. The installed auth
  adapter uses a read/conditional-update fallback for database rate counters,
  while signed-in clients poll sessions. Verify trusted proxy boundaries and
  exact throttle/revocation behavior before choosing an optimization. Do not
  disable throttling, accept spoofable identity headers or cache authorization
  results past their existing validity to reduce writes.
- Run a bounded staged workload with providers replaced by deterministic mocks:
  same-key bursts, distinct-key bursts, slow/failing providers, expired leases,
  owner switches and exhausted allowances. Measure server latency, database read
  volume, write contention and returned payload size separately from upstream
  request counts. A mock fanout test alone does not prove production throughput.

## Verification and rollout boundary

Existing isolated tests cover two hundred concurrent chart readers, duplicate
quote admission, distinct-wallet admission limits, owner isolation, cache expiry,
backoff, signature-before-network registration and no resend after uncertainty.
The added regression coverage exercises late search completions, stable public
query arguments and retained-value identity/freshness boundaries. All provider, RPC,
wallet and payment actions in these tests must be inert or denied.

Before a release, run the full unit/backend and isolated browser suites, both
type checks, lint, native UI parity, dependency/security checks and all five app
builds on one unchanged candidate. Review schema compatibility and preserve every
existing financial, privacy and authorization gate. Production Convex rollout
requires explicit target/action approval; a merged frontend or mocked load test
does not activate or certify the backend. Do not replay old calls to demonstrate
the change.
