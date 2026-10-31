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

## The current capacity ceiling

Concurrency and daily coverage are different constraints. Sharing a cached
instrument with hundreds of viewers is not the same workload as fetching hundreds
of different wallets or instruments for the first time.

The current terminal allowance is **100 reserved units/day**, shared by public
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
