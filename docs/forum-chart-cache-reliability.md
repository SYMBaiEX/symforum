# Shared chart-cache reliability

The terminal and the legacy SYMF chart use the same Convex admission controls,
with separate cache keys for dynamically selected pools and the legacy pinned
SYMF pool. The pinned chart never falls back to a different pool. Mint, pool,
quote-token and candle validation remain mandatory before saving new data.

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

## Verification boundary

Regression tests exercise a good response followed by failures, server deadlines,
concurrent viewers, expired leases, late completions, retention, pinned identity
and safe diagnostics. Browser tests intercept providers locally and verify stale
rendering and visibility behavior; they do not perform swaps or agent calls.
Production acceptance is bounded to ordinary public chart reads and read-only
configuration/hold comparisons. It never fabricates a production outage, replays
an uncertain call, signs a transaction or changes budgets.
