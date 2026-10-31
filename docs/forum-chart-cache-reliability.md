# Shared chart-cache reliability

The terminal and the legacy SYMF chart use the same Convex admission controls,
with separate cache keys for dynamically selected pools and the legacy pinned
SYMF pool. The pinned chart never falls back to a different pool. Mint, pool,
quote-token and candle validation remain mandatory before saving new data.
Both website SYMF chart URLs now resolve to the configured official pinned-pool
cache, with an additional exact pool/SOL-quote check at the HTTP boundary. Other
tokens retain dynamic pool selection. Old generic cache records and the public
Convex reader are not migrated, reset or removed by this website canonicalization.

## Freshness and failures

- A successful response stays fresh for five minutes. Its original `checkedAt`
  and payload are retained for up to 24 hours; failed refreshes never rewrite
  them. Retained charts visibly say they are stale.
- Retry timing is server-owned and separate from data retention. Failed attempts
  back off from one minute to fifteen minutes. Valid provider rate-limit hints
  can defer requests for up to 24 hours; quota deferrals use the next UTC reset.
- A durable attempt fence is written before external I/O. The short concurrency
  lease expiring is not permission to repeat an uncertain request early. A late
  writer cannot overwrite the accepted cache.
- Cleanup observes current retention and retry/lease fences, including when an
  older cleanup callback runs after a newer attempt.
- Browsers request data only while their chart is visible, the page is in the
  foreground and the browser is online. They respect server retry deadlines and
  evict retained data at the same 24-hour boundary. No user-triggered force-refresh
  bypass exists.

## Diagnostics and limits

Responses expose only bounded timestamps, a failure count, a closed stage/code
classification and the original public chart data. Failure logs use fixed
stage/code fields, not upstream bodies, raw exceptions, credentials or user data.
No diagnostic endpoint bypasses admission or performs extra provider requests.

The existing terminal allowance of 100 units/day and shared commerce allowance of
1,000 units/day are unchanged. Each chart fill reserves two units. At most 50
chart fills/day fit in the terminal allowance before other reads; continuous
five-minute freshness across arbitrary charts is not possible at that cap.
Retention keeps charts readable during upstream outages or quota exhaustion,
without representing old values as live quotes. Swap quotes, simulation,
publishing, agent budgets/schedules, scout eligibility and uncertain-outcome holds
are outside this change and remain unchanged.

The broadcast worker's independent market-cap feed is not a chart consumer and
is not migrated by this change.

## Free SYMF candle fallback

Gecko requests now select the exact mint, not the provider-relative `base` side.
For this explicit-mint mode, both metadata addresses must still be exactly the
validated mint/quote pair; their ordering may differ from Dexscreener's. Legacy
base-relative parser calls keep their original directional identity check.
Gecko's documented API version is pinned. Empty history, schema, identity and
numeric candle failures have separate closed diagnostic codes.

After a completed Gecko candle failure, a later ordinary, due SYMF chart attempt
can select Solana Tracker's documented token/pool USD chart endpoint instead.
This is a substitute for the second upstream request, never an extra third
request after trying Gecko. Every attempt still reserves two units from the
unchanged terminal/shared caps and freshly validates its Dexscreener pool binding.
There is no public provider override, force-refresh flag or uncertain-call replay.

The Tracker call also reserves the original shared 70/day and 2,300 rolling
allowances. A new restrictive 12/day candle subcap leaves room for 48 scheduled
ranking calls and the original 10 enrichment calls. It does not increase any
existing quota, change agent schedules, enable paid service, or refund failures.
Quota denial makes no Tracker call; prior dated data remains subject to the
existing retention and backoff rules.

The server validates the exact controlled request path, optional returned identity
echoes, USD selection, bounded timestamps/row counts, finite OHLCV, price ranges
and duplicates. It does not synthesize inactive intervals or reverse price ratios.
Tracker latest-history requests omit the optional time bounds: a fixed number of
contiguous buckets incorrectly rejects legitimate sparse historical bars. Every
source row (at most 2,000 within the unchanged byte ceiling) is validated before
retaining the latest 120. Explicit-range mode still rejects out-of-range rows
when bounds are actually requested. No malformed row is discarded by truncation.
The UI separately dates historical bars; a fresh fetch timestamp never claims
that a historic bar represents a recent trade. Fresh Dexscreener metrics remain
independent of the historical close.
`candleSource` uses a closed provider enum. The UI displays its fixed provider
credit with the original check time, and legacy records retain Gecko attribution.

This is bounded fallback coverage, not a guarantee of continuous five-minute
freshness across every viewer, interval and cache namespace. The original free
allowances still apply; stale values are never represented as executable quotes.

Provider contracts:

- [Gecko public API](https://api.geckoterminal.com/docs/v2/swagger.json)
- [Tracker token/pool OHLCV](https://docs.solanatracker.io/data-api/chart/get-ohlcv-data-for-a-tokenpool-pair)
- [Tracker plans](https://docs.solanatracker.io/pricing)

## Terminal layout follow-up

The terminal keeps one instrument workspace with a desktop chart/order split and
stable mobile panes. Selected-token context no longer repeats in a second mobile
header. Metrics reflow at narrow widths instead of shrinking, no-data charts use
a bounded state panel, disclosure tables have one scrolling owner, and real touch
controls retain 44px targets. Sparse real history has bounded candle width rather
than a single viewport-wide bar. These presentation changes do not alter wallet,
quote, signing, publishing, recovery or chart-request controllers.

## Verification boundary

Regression tests exercise a good response followed by failures, server deadlines,
concurrent viewers, expired leases, late completions, retention, pinned identity
and safe diagnostics. Browser tests intercept providers locally and verify stale
rendering and visibility behavior; they do not perform swaps or agent calls.
Production acceptance is bounded to ordinary public chart reads and read-only
configuration/hold comparisons. It never fabricates a production outage, replays
an uncertain call, signs a transaction or changes budgets.

Release verification: 4,214 unit/backend tests, 167 isolated browser checks,
application/Convex type checks, shared native UI parity and all five application
builds passed. Lint has zero errors and the same three pre-existing warnings.
The dependency audit still flags the two pre-existing moderate glob/minimatch
advisories in unchanged transitive dependencies; no dependency version or lockfile
is changed here, and the audit is not represented as passing.
