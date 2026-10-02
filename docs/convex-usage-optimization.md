# Convex usage optimization

## September 22 projection and lifecycle pass

This release removes the remaining large-document reads from common public
paths and makes the corresponding compact projections lifecycle-safe:

- Public post lists use `postDigests`, so article bodies are not read merely to
  render cards. Featured-post selection keeps the existing newest-50 contract.
- Newsletter click routing is stored in the compact issue digest. Engagement
  deduplication uses one exact compound-index lookup instead of overlapping
  scans of the engagement table.
- Universal search reads one bounded compact projection across evidence, blog,
  newsletter, news, and forum content instead of loading hundreds of full
  source records. Every source writer updates the projection transactionally;
  visibility-policy changes invalidate the projection and start a resumable
  rebuild. It remains on the live fallback until its forum-search dependency is
  complete, and full-document migration pages have both row and byte ceilings.
- News projections retain their exact story and snapshot provenance. Search
  rejects removed stories and running or failed snapshots immediately, while
  bounded reconciliation repairs the compact index in the background.
- Forum search performs one bounded point-in-time pass. Route lookup and agent
  duplicate-title checks use compact projections, and exact view counters are
  isolated from subscriber-facing thread rows. Thread/search counters update at
  view 1 and then every 25 accepted views.
- First-party forum evidence is dirty-driven. Publication, edits, moderation,
  moves, category access changes, quality decisions, and deletions enqueue one
  generation-guarded item. A resumable reconciliation covers historical and
  orphaned records. Public reads fail closed while retraction is pending, and
  claim retraction continues in bounded pages after the owning document is
  hidden. Queue row identity plus generation fences stale workers, including a
  delete-and-recreate ABA case, before publication, retraction, or acknowledgement.
- Research jobs, exports, and retained dataset snapshots carry the current
  publication epoch. Restrictive source or record changes advance that epoch,
  so previously generated artifacts fail closed until regenerated against the
  current visibility policy.
- Webhook attempts acquire a lease only when the delivery action actually
  starts. Scheduler delay no longer consumes retry attempts.
- The analytics write limiter keeps the existing global budget but uses three
  contention shards, reducing optimistic-concurrency retries under bursts.

The existing-table indexes added here were measured before rollout: 5,143
newsletter engagement rows and 642 rows in each affected forum projection
table. They are intentionally enabled in the release rather than staged; these
are bounded, small backfills, while staged indexes cannot be queried by the new
functions until a second schema deploy.

### One-time production rollout

Deploy functions first. These reads retain their legacy fallbacks until the
matching marker is complete. Start each migration once; it stores its own
cursor and schedules bounded continuations:

```sh
bunx convex run postDigests:backfillPostDigests '{}' --deployment strong-bee-384
bunx convex run newsletterDigests:backfillNewsletterIssueDigests '{}' --deployment strong-bee-384
bunx convex run universalSearchProjection:backfill '{}' --deployment strong-bee-384
bunx convex run evidenceFirstParty:requestHistoricalReconciliation '{}' --deployment strong-bee-384
bunx convex run evidenceFirstParty:syncForumResearch '{}' --deployment strong-bee-384
```

Do not loop these commands from cron. Each migration persists progress and
self-schedules; the evidence sync queue is then maintained by writer hooks and
the existing low-frequency safety job.

## September 22 read-cost follow-up

The bounded production sample preceding this release contained about 18 MB of
database reads over 38 minutes. `forum:search` accounted for 11.67 MB and
`forum:listCategories` for 2.05 MB. This is an execution sample, not a monthly
bill or proof that every request originated from an agent.

- Opening a thread no longer starts an automatic related-search subscription.
  The explicit discovery link opens the existing point-in-time search page;
  it does not prefetch a search on hover or viewport entry.
- Relevance searches start with the requested candidate count and expand only
  when visibility/filtering requires it. The existing hard caps, private-board
  and ancestor checks, and advanced-sort scans remain. Reply hydration dedupes
  thread IDs before loading their compact projections.
- Board navigation reads editorial digests and projected last-post numbers.
  Missing legacy projections retain the original read/position fallback.
- Recording a view no longer changes a thread's content timestamp. First-party
  evidence hashes include content, canonical location, quality, and provenance,
  not engagement timestamps. Strict content-hash matching retains changes to
  metadata and content reversions as real versions.
- First-party enrichment commits one document and its provenance atomically.
  A small content-keyed checkpoint skips completed unchanged work. A failed
  transaction cannot leave a completion marker or a half-enriched version.
  The four-hour bounded reconciliation of up to 100 research records remains;
  this is incremental enrichment, not a claim that source discovery reads zero
  rows or that all historical research is backfilled.
- Webhook delivery and semantic-budget leases schedule recovery at expiry.
  Generation/terminal-state checks make old wake-ups harmless. Crashed webhook
  attempts consume retry budget rather than retrying forever.
- Watchlist outbox inserts schedule bounded dispatch, which continues while a
  batch is full. Webhook, watchlist, and semantic recovery retain hourly safety
  sweeps instead of five-minute polling. Their watchdog thresholds follow the
  new cadence. Research generation, ingestion, and health canaries are unchanged.
- Completed search-projection and embedding migrations no longer have recurring
  cron jobs. On a fresh deployment, an operator starts them once; they persist
  progress and schedule bounded continuations themselves:

```sh
bunx convex run forumSearchProjection:backfill '{}' --deployment strong-bee-384
bunx convex run forumAgentMemory:backfillForumMemory '{}' --deployment strong-bee-384
```

Do not rerun these on production merely to measure costs. Both migrations were
already complete there before this release. The new first-party checkpoint
table needs no backfill: the next normal synchronization establishes checkpoints
transactionally. Existing first-party research may receive one content-keyed
version when transitioning from the older timestamp-based fingerprint.

The three recovery cron schedules drop from 864 to 72 wake-ups per day, plus
145 eliminated migration cron wake-ups. Actual work still schedules recovery
and continuations, so these are idle-schedule reductions, not promised billing
savings. Verify database I/O and Search Query-GB separately over a full day in
the Convex dashboard; a low response size does not establish low database cost.

This release addresses the production read/write hotspots identified from
`bunx convex insights --prod`, production logs, and bounded production data
sampling on 2026-08-17 and 2026-09-01.

## September 2026 audit

The latest aggregate production usage snapshot checked on 2026-09-22 reported
34,578 function calls, 0.8797 GB of database I/O, 0.0262 GB of data egress, and
37.3902 Search Query-GB for the current-day window. Convex's CLI returns these
as deployment-wide metrics and does not attribute Search Query-GB to individual
functions. The 72-hour Insights view showed no broad read-limit issue. Analytics
was its most frequent OCC signal, but sampled retry counts were zero, so the
existing three-shard configuration remains in place. This snapshot alone does
not establish that search is the source of the high usage.

The 2026-09-01 production snapshot for `strong-bee-384` reported 0.1368 GB of
database I/O, 0.0020 GB of data egress, 3,202 function calls, and 0.1199
Search Query-GB for the current day. The current-month Search Query-GB total
was 735.8888 even though the live daily rate was small. Convex's CLI does not
expose a per-day or per-function breakdown for that monthly metric, so the
exact historical spike is intentionally left unattributed.

## October 2 contention follow-up

The read-only production Insights window for the prior 72 hours reported 77
OCC retries on `newsletter.js:recordPublicEngagement`, all attributed to the
rate-limiter component's `rateLimits` table. Sampled calls retried up to three
times. The `engagementGlobal` token bucket already used six shards, so the
configured shard count is increased to twelve while keeping its global budget
at 600 events per minute with a burst capacity of 120. The rate limiter divides
that budget across shards and checks two shards per request; more shards reduce
overlap, but uneven shard utilization can still occasionally reject early.
At twelve shards, this token bucket keeps ten burst tokens per shard; doubling
to twenty-four would reduce that to five and trade more contention relief for
greater burst fragmentation. Keep twelve until a post-rollout Insights sample
shows the remaining retry rate justifies that trade.
This is a concurrency mitigation, not evidence of reduced database I/O, and it
has not been deployed or measured post-change.

The newsletter issue-view tracker now keeps a bounded 50-issue, one-hour
browser-side cooldown matching the server dedupe window. Returning to the same
issue in the same browser no longer sends a mutation that would only consume a
rate-limit token and perform the server's duplicate lookup. Storage failure
fails open, and server-side visitor deduplication/rate limiting remains
authoritative. Redirect-click events still use the server path. This reduces
repeat browser requests by construction but has not been measured in production.

The site-wide page-view tracker now suppresses effect replays for the same
session and route during the server's 1.5-second dedupe window. This avoids an
extra mutation request before it reaches analytics rate limiting and the
duplicate check; failures release the local attempt so a later effect can retry.
The cache is in-memory and bounded, so it does not retain route history or
replace server-side deduplication. The 72-hour production sample included one
analytics rate-limiter OCC retry; post-change request volume has not been
measured.

The public engagement mutation now validates the published issue and event,
checks the bounded visitor/story dedupe key, and only then consumes the shared
rate limiter immediately before inserting a new event. Replayed or invalid
events therefore avoid writes to the limiter's shared hot state; unique events
remain rate-limited and the limiter plus event insert still commit atomically.
The observed 77 retries do not identify how many requests were duplicates, so
the contention improvement is plausible but unmeasured after rollout.

Redirect links previously made a public destination query followed by an
engagement mutation that fetched and validated the same issue routing again.
They now use one mutation to resolve the target and record the click from that
single issue snapshot, while still returning a valid destination when the
engagement rate limiter rejects tracking. The old read query remains available
for compatibility and the route's transient-failure redirect fallback. That
fallback now performs only the destination read; it does not retry engagement
logging after a failed mutation, because the original write may have committed
and a second write would contend on the same global limiter. Analytics is
best-effort only on that error path.
The normal path removes one Convex request and one duplicate issue-routing
lookup; production volume/savings have not been measured.

The same window reported 12 OCC conflicts on `universalSearchProjections` for
`news.js:storeSnapshot`, with sampled writes coming from
`news.js:reconcileStoryProjection`. Reconciliation previously deleted the
projection before calling a sync helper that already performs a no-op check.
It now updates only when the surviving story changes the projection, avoiding
an unnecessary delete/reinsert and preserving the projection row ID. A focused
test covers snapshot invalidation with a surviving story; production impact is
not verified until deployed.

During each successful news refresh, `storeSnapshot` now builds the search
projection from the story fields it already has and the ID returned by
`insert`, instead of reading every inserted story back. The writer also passes
the snapshot's complete status within the same transaction so the helper avoids
re-querying the same snapshot for each story. This removes up to two database
API reads per story (up to 80 in the configured 40-story refresh); other helper
callers still verify snapshot visibility. This is a code-shape estimate, has
not been measured in production, and is undeployed.

The public story detail lookup now uses a compound `(hnItemId, fetchedAt)` index
and returns the newest version directly. The previous lookup read up to 50
historical snapshots, sorted them in memory, and could miss the latest version
once that item had more than 50 rows. This makes the read independent of history
length and preserves fetched-time ordering even when overlapping refreshes
commit out of order. The additional index backfill and live read savings have
not been measured; this change is undeployed.

Convex `runRoutedCandidates` sends `openrouter/free` as a standalone request;
the paid rescue is a separate candidate call. [OpenRouter documents the free
router as zero-priced](https://openrouter.ai/openrouter/free), so that free attempt no longer creates a paid spend
reservation or temporarily occupies the daily budget. The separate paid
candidate still reserves before its provider call. The owner-console stream is
different: it can fall back internally within one streamed request, so it
continues to reserve against the paid alias before starting. Usage settlement
maps explicit `:free` provider IDs, or an exact or omitted result for a known
standalone free request, to zero; unknown nonempty or contradictory model IDs
still fall back to the paid alias. Successful usage records retain the
requested route and provider-reported model separately from the billing model. The local change
reduces one Convex preflight call and avoids reservation writes for free
attempts; production effect is unverified and undeployed.

The same Insights window did not report newsletter admin analytics as a hot
read path. Its full-issue reads remain behind an explicit operator action.
The local admin UI now fetches a one-shot snapshot only when requested and
refreshes only on another click, rather than opening a live subscription that
could rerun the report as events arrive. The query can still read up to 120,000
event and engagement rows per snapshot (30 issues × 2,000 of each), plus
bounded linked-story save reads if the aggregate migration is incomplete. This
prevents repeated reactive recomputation but does not reduce the cost of one
snapshot; production impact is unmeasured and the change is not deployed.

The latest bounded successful-execution sample, collected on 2026-09-22, had
1,000 function completions over 65 minutes and 45 seconds. It recorded
7,009,773 database-read bytes and 871,550 database-write bytes. Its text-search
read-byte field was zero and its text-search write-byte field was 84,275. This
is a recent sample, not the full-day window in the usage snapshot; it must not
be extrapolated into a daily or monthly total. In that sample, evidence
`linkDocumentEntity`, `upsertEntity`, `recordCitation`, and
`upsertDocumentVersion` were the largest repeat read paths. Recent Insights
also showed five search-index metadata OCC signals during the universal-search
backfill, with zero retries; analytics had 94 OCC signals in the wider view,
also with zero retries. No read-limit insight was reported.

The Convex dashboard was then checked read-only for `symbaiex-blog`. For
2026-08-23 through 2026-09-22 it showed 14.43 GB database I/O, 1.60 GB data
egress, 75.57 MB search storage, and 44 Query-GB. For the current billing week
(2026-09-15 through 2026-09-22), it showed 9.54 GB database I/O, 441.73 MB
egress, and 28 Query-GB. The function breakdown attributes 7.00 GB of the
30-day database I/O to `forum:search`; the next largest were
`forum:listCategories` (858.24 MB), `forum:routeStatus` (835.47 MB),
`evidence:recordCitation` (548.58 MB), `evidence:upsertDocumentVersion`
(534.52 MB), and the completed universal-search backfill (469.96 MB).

Search attribution is now concrete for that dashboard window: 28 Query-GB of
the 44 total came from `forum:search`, 15 from `search:search` (RAG), and
0.02301 from `universalSearch:searchPublic` (rounded dashboard figures may not
sum exactly). That makes forum search the leading search and database-I/O
consumer, while the universal index is not a material source in this period.
The CLI's separate 37.3902 Search Query-GB snapshot and the dashboard's
different time windows should not be compared as if they were the same bucket.
Convex documents that text-search queries are billed against the full size of
the search index, even when few results match or filter fields narrow the
returned set ([text search pricing](https://docs.convex.dev/search/text-search)).

The next read-only dashboard check for the current cycle showed 9.56 GB of
database I/O, of which 9.32 GB was reads and 238.98 MB writes. `forum:search`
accounted for 6.42 GB, followed by `forum:routeStatus` at 629.16 MB and
`universalSearchProjection:backfill` at 469.96 MB. The backfill's migration
marker is complete and no continuation was pending, so it is historical
one-time work rather than an active poll. The completed search migration,
combined with the high read share and forum-search attribution, makes repeated
status-index reads the actionable live path.

Relevance forum searches now query active candidates first, apply visibility
and user filters, and skip the locked-status text search when active matches
already fill the requested result window. If the window is short, they query
only its remaining capacity (with bounded visibility overscan for global
search). Advanced sorts still fetch both statuses because locked rows can
change their ordering. This preserves active-before-locked relevance order,
private-category and ancestor filtering, result paging, and the bounded
`limited` signal while avoiding an unneeded search-index scan on full relevance
pages. When a short page needs the locked pass, category visibility results
from the active pass are reused for categories already checked. Regression
tests cover legacy and projected searches, private visibility, and continuation
to locked rows on later pages.
Recheck `forum:search` DB I/O and Search Query-GB after the change is deployed;
the source snapshot is a baseline, not a measured savings claim.

`forum:routeStatus` was the next live read consumer (629.16 MB in the same
window). Its shared ancestor-visibility helper performed the target board's
moderator-assignment lookup twice for each authenticated, non-staff request.
The helper now reuses that result; ancestor checks and board-level moderator
overrides are unchanged. This avoids one redundant indexed assignment read per
such route check. The route-visibility suite still covers public, trusted, and
assigned-moderator access.

The universal index intentionally serves a single cross-corpus request across
evidence, claims, entities, editorial content, news, and forum threads. A type
filter does not make a full-text query cheap by itself. Splitting it into
several per-type searches would not reduce total index bytes for an all-types
query and could increase them. Do not trim research text or change default
search semantics without a retrieval-quality comparison. The measured forum
search path instead received two bounded read reductions: navigation/filter
surfaces now request compact category options rather than full board summaries,
and a category-scoped search no longer reloads the same authorization graph
after the handler has already authorized that category. Neither changes public
search semantics or visibility checks.

Universal forum search now resolves only category IDs referenced by its
bounded active/locked candidate set, plus their active public ancestors. This
replaces an unconditional first-200 category read that could omit otherwise
matching public boards beyond that position. Candidate and ancestor lookups are
bounded, shared by both the compact-projection and legacy fallback paths, and
retain the existing fail-closed visibility and cycle checks. The code-path
reduction is covered in tests; it is local and has not been measured after
deployment.

The follow-up implementation removes projection synchronization from
idempotent evidence-write retries. Those retries previously re-read an
entity's linked document graph (up to 50 links) or revalidated citations and
search-index rows even though the source record had not changed. Real document,
entity, claim, link, and citation changes still update projections in the same
transaction. When an entity does change, its current projection's live public
document reference is checked first; only a stale or revoked reference falls
back to the complete bounded relation scan. This keeps visibility fail-closed
while avoiding the historical-link walk for the normal update.

The new compact `forum:listCategoryOptions` query serves only navigation and
search filters. It preserves active-board and per-viewer category visibility,
but omits latest-thread summaries, author hydration, pagination targets, and
per-viewer read markers that those controls never render. The full
`forum:listCategories` endpoint remains unchanged for board views that need
those fields. The measured dashboard contribution (858.24 MB over 30 days)
supports this targeted split; verify the next billing-week breakdown before
claiming a realized savings amount.

A bounded successful-execution sample did identify one active database-read
defect: `forum:listRecentThreads` accounted for 118,371,552 bytes across 22
sampled calls, about 5.38 MB per call and roughly 97% of all sampled database
reads. It was loading up to 1,000 full thread records, including bodies and
search text, to render a compact list.

## What changed

- The forum sitemap uses one privacy-filtered compact digest query instead of
  loading every thread body once per public category.
- The daily newsletter scheduler reads its configuration in one query and
  stops before invoking generation for terminal, cooling-down, or exhausted
  runs. Repeated `Daily newsletter already sent` logs are no longer written.
- Evidence webhook fanout is indexed by event type, capped, and stores no event
  when no active subscriber can receive it.
- Forum liveness uses `@convex-dev/presence`; route location is a low-churn
  snapshot and no longer acts as the heartbeat clock.
- Interaction scores, saves, and active comment counts use
  `@convex-dev/aggregate` after a migration-safe, self-scheduling backfill.
- Analytics capture health is stored as privacy-safe UTC date buckets for
  captured writes and rate-limited drops only; it retains no visitor, session,
  user-agent, path, referrer, or raw metadata. The admin summary exposes the
  resulting capture ratio.
- Newsletter archive lists use compact issue digests and never read full issue
  bodies after the digest backfill completes.
- Recent-thread lists use compact editorial digests after the v2 digest
  backfill. The legacy full-thread scan remains only until the migration marker
  proves every historical thread was projected.
- Forum search runs as a point-in-time query when submitted rather than keeping
  a search-index subscription alive after navigation. Universal search uses
  the bounded forum search projection instead of full thread documents.
- The shared client query cache releases idle subscriptions after 60 seconds
  and retains at most 80 idle entries instead of 15 minutes and 400 entries.
- The owner telemetry page uses one reactive Convex snapshot; it no longer
  duplicates that query through a second API poll every 15 seconds.

## Production migration order

Deploy the Convex functions first. The new reads retain legacy fallbacks until
their migration status is marked complete.

Start each aggregate backfill once. It persists its cursor, schedules the next
batch itself, and advances interactions to comments automatically. Re-running
the command is safe and reports the completed state:

```sh
bunx convex run contentAggregates:backfillContentAggregates '{}' --prod
bunx convex run newsletterDigests:backfillNewsletterIssueDigests '{}' --prod
bunx convex run evidenceWebhooks:backfillSubscriptionTargets '{}' --prod
bunx convex run forumThreadDigestBackfill:run '{}' --prod
```

After deploying an NVD pagination-recovery change, an operator may bypass only
the stored retry timer for one diagnostic fetch; the cursor and window are not
advanced unless the complete page validates and persists:

```sh
bunx convex run evidenceNvd:syncCves '{"force":true}' --prod
```

To seed the new bounded research-reply mode without reopening old discussions,
queue at most six recent AI-authored opening threads once. The command is
idempotent and applies the same distinct-agent, daily-cap, and canary gates as
new publications:

```sh
bunx convex run forum:queueRecentAgentThreadResearchReplies '{"limit":6}' --prod
```

The two cleanups are deliberately narrow and idempotent. Repeat them until
`done: true`:

```sh
bunx convex run dailyNewsletter:cleanupDuplicateAlreadySentLogs '{}' --prod
bunx convex run evidenceWebhooks:cleanupOrphanDeliveryEvents '{}' --prod
```

The webhook cleanup refuses to delete anything if any webhook subscription or
delivery exists. The newsletter cleanup deletes only skipped rows with the
exact historical duplicate message.

## Verification

After migration, verify the migration records, public reads, and production
logs:

```sh
bunx convex data optimizationMigrations --prod --limit 20
bunx convex run forum:listPublicSitemapRecords '{"month":"2026-08","limit":5000}' --prod
bunx convex logs --prod --history 100 --status failure
bunx convex insights --prod --details --json
```

Expected steady state:

- one compact Convex query per sitemap render;
- no repeated terminal newsletter action or duplicate skipped log;
- no `apiWebhookEvents` growth while there are no subscribers;
- presence heartbeats isolated inside the Presence component;
- interaction and newsletter list reads use completed migration records.
- `analytics:summaryAdmin` includes `capture.captured`,
  `capture.droppedRateLimited`, and `capture.captureRatio` sourced exclusively
  from date buckets.
- a post-backfill `forum:listRecentThreads` execution reads compact digest rows
  and stays below 0.5 MB of database reads for a normal page. The first
  production measurement after the migration was 417,452 bytes, down from the
  5.38 MB sampled baseline (about a 92% reduction).

## October 2 AI spend guard

Paid Convex model attempts now reserve their estimated cost atomically against
the shared daily OpenRouter spend buckets before the provider request starts.
The transaction includes semantic-search reservations, so concurrent research
and editorial calls cannot each pass a stale read-only budget check. Successful
calls replace the estimate only when the routed model reports complete token
usage (input-only for embeddings); missing or invalid counters retain the
conservative reservation and record only the counters actually reported,
without fabricating zero usage or cost. A later complete receipt updates that
same event, so retries do not double-count it. Failed or interrupted paid
attempts likewise retain the estimate for the rest of that day as a conservative
charge. Old reservation records follow the existing 35-day operational-data
retention. The integer micro-dollar ledger rounds any
positive model cost up, so short paid embedding queries reserve at least one
micro-dollar instead of being rejected or accumulated as zero-cost calls.

Free-model attempts do not read or write spend buckets. Routing-control reads
now fetch only active provider circuits; spend is queried only when a paid
attempt needs a reservation. Prompt reservations use a buffered character
estimate plus an instruction/tool allowance and the request's actual maximum
output-token cap. The owner-console Next.js stream now reserves before every
model step through an owner-authenticated Convex mutation and caps each step at
1,200 output tokens. It reserves against the configured paid fallback even when
the free route is selected. When the provider reports a resolved `:free`
variant, the Next.js server signs a route-bound settlement with the separate
`AI_USAGE_SETTLEMENT_SECRET`; Convex verifies it before settling at the free
route's zero price. Missing metadata, signature, or exact free-variant
identification falls back to the paid rate, and missing usage or a failed
settlement leaves the conservative reservation intact. The shared secret is
optional for compatibility; until the same 32+ character value is configured
in Vercel and Convex, owner-console steps settle conservatively at the paid
fallback rate. Owner-console usage is also included in the shared model-usage
history. The public reservation and settlement endpoints cannot choose their
own reservation model or day key, and an authenticated owner cannot forge a
free settlement without the server signature.

Successful token receipts now reach shared accounting for Suki forum generation
and replies, Belle's HN digest and newsletters, evidence research, and the
structured-route canary. Forum editorial-memory retrieval, thread indexing,
and the periodic embedding health probe now reserve input-only usage against
that same cap before calling OpenRouter; a denied reservation skips the
optional memory operation. Semantic and model routes now bucket against the
same America/Chicago day boundary, preventing their per-day counters from
splitting at different midnights. Billing normalizes exact `:free` responses
to the known free route, while paid or ambiguous responses normalize to the
configured paid fallback alias; requested and provider-reported IDs remain
separately recorded. This change has not been deployed; production savings
and caps remain unverified until a later approved rollout and usage readback.

Editorial-memory retrieval used to validate every returned RAG candidate
through a separate Convex query even though it returns at most eight threads.
It now rechecks current thread/category visibility in ordered batches of eight,
caches repeated category and author rows within each query, and stops once it
has eight public results. This is usually one hydration query when the first
batch remains public and at most four for the 32-candidate window. It does not
reduce the embedding request itself; provider and production read savings are
unmeasured until deployment.

The routed candidate chain now stops after OpenRouter HTTP 401 (invalid
credentials) or 402 (payment required), records the failed candidate, and runs
its normal conservative reservation cleanup. Those account-level failures
cannot be repaired by sending the same prompt to another model with the same
credentials. Other statuses remain eligible for the configured model fallback,
including model-specific structured-output incompatibility. This guard is local
and undeployed; post-rollout provider-error counts will show whether it avoids
redundant attempts.

The owner telemetry snapshot keeps settled model spend separate from the
conservative reserve held for failed or ambiguous provider attempts. Each route
event records its candidate estimate; failed-attempt holds are exposed per
model and in a separate total so a timeout does not appear as a free call or
get mistaken for a confirmed provider charge. The daily budget figure remains
the aggregate source of truth. This accounting view is local and unshipped.

All Convex structured `ToolLoopAgent` stages are explicitly limited to one
model step, matching their schema-only submission tools; the owner stream has
its separate eight-step cap and reserves each step. Convex RAG components
previously invoked AI SDK `embed`/`embedMany` with the default two retries,
outside the caller's single reservation. Query and document embeddings now use
explicit zero-retry AI SDK calls, preserve the RAG default chunker, pass vectors
into the component, and record the returned token usage. Embedding batches run
sequentially. Explicit or interrupted semantic failures retain the conservative
reservation when provider acceptance is ambiguous rather than refunding a
possibly billable request.

When semantic search and the separate `SEMANTIC_SEARCH_AUTO_INDEX_ENABLED`
switch are enabled with a validated model, budget, and API key, public document
updates and republications enqueue an indexing workflow whose document action
is idempotent. That
dedicated workflow runs at most one embedding action at a time, keeping
ingestion bursts from becoming concurrent provider bursts. It stays dormant
when either opt-in or the validated provider config is absent. Embedding
candidates are current by document revision: source visibility and status are
still rechecked against primary records, while unrelated source metadata changes
no longer invalidate otherwise-current vectors. This automatic path has not
been deployed or measured yet.

Temporary preflight skips are not silently terminal for newly updated
documents: a daily-budget rejection is retried once in the next daily window,
and an open circuit is rechecked at most four times at 15-minute intervals.
These retries do not repeat provider calls unless a fresh reservation succeeds.
An individually oversized document is skipped without stopping later documents
in a source catch-up; persistent budget or circuit rejection still stops that
catch-up rather than spinning through the corpus.

Reactivating a previously private/paused source now starts a source-scoped
catch-up workflow rather than relying on a later whole-corpus backfill. It
reads five public document IDs per indexed page, uses the same serialized queue
and per-document spend reservation, waits once after daily-budget exhaustion,
and stops if the retry is still rejected or the source is no longer indexable.
A single document that became private after selection is skipped without
preventing later public documents in that source from being indexed.
This closes the semantic-retrieval freshness gap without scanning unrelated
sources. It is local and undeployed; provider usage and completion latency are
not measured.

Source catch-up and operator backfill now reuse a successful embedding for the
same document revision and model even when the source's metadata revision has
changed. The bounded catch-up path scans only that document revision's legacy
marker range, then promotes a match to a stable content marker; ordinary
per-document indexing stays on a direct marker lookup. This avoids a redundant
provider call for source-only changes, without changing document- or
model-change behavior. The number of avoided embeddings is unmeasured; this is
local and undeployed.

The index action now uses one preflight query for both the semantic circuit
state and the document/source/indexed-revision check. It still short-circuits
before reading the document when the circuit is paused, but an active indexing
attempt no longer performs two sequential internal query calls. This reduces
function-call/round-trip overhead, not the successful path's document reads;
production call volume and savings remain unmeasured.

Evidence visibility checks now memoize source records, forum authors, category
ancestors, and each document's publication-policy result for one Convex query
context. Export validation also seeds this cache with source rows it already
loaded. A new query gets a fresh snapshot and rechecks current policy. This
reduces duplicate validation reads without weakening source, thread,
assessment, or category checks.

Universal-search projection writes now use that same publication helper as the
source of truth. The document writer no longer fetches its source once directly
and then again through visibility validation; claim citation processing also
omits a second source read after the helper has already confirmed the source is
public and active. Regression coverage verifies that both projections still
disappear when the source is paused. This removes redundant lookups by code
shape; production call frequency and savings have not been measured.

A fresh read-only production Insights query on October 2 returned three
`evidenceJobs:readExportDocuments` read-limit failures in its rolling 72-hour
window, dated September 30, October 1, and October 2. The latest failure read
about 17.1 MB: document versions about 5.8 MB, forum threads 4.8 MB, evidence
documents 3.1 MB, and quality assessments 1.2 MB. It also read 783 citations
and 1,273 document-entity links. Each selected row's provenance checks can expand
into additional document/version reads. The production forum-search projection
backfill marker is complete, while this trace still reports substantial reads
from canonical forum threads; that suggests the deployed export path may not
yet match the local compact-projection branch, but its deployed revision was
not verified.

The local exporter now treats a public entity link on a validated current
document version as the live public reference it already is, instead of
walking the entity's broader reference graph again. For a first-party forum
claim naming that exact document, its citation on the validated current version
likewise proves the source reference; cross-document claims retain the full
visibility check. Tests cover matching versus unrelated claim keys and ensure
private entities do not leak. This targets repeated graph reads, not the
selected record payload itself; the change is not deployed, so its effect on
the 17.1 MB production event is not yet measured.

The shared visibility helper also memoizes owner-document reads by document ID
within one query context. Repeated claim/entity provenance joins therefore
reuse the same document row without carrying visibility data across query
snapshots. Tests verify same-query coalescing and cross-query isolation; the
production effect has not been measured.

The request-local cache still targets repeated source, author, and category
reads. Export visibility checks prefer the smaller
`forumThreadEditorialDigests` row for thread status and category once its
backfill is complete. If that row is missing, they next try the bounded
`forumThreadSearchProjections` row after its backfill; only then do they fall
back to the canonical thread. Both projections are maintained by the relevant
thread writers, and neither is an authorization source before its completion
marker. This avoids reading the full forum-thread body for an export-only
access decision and avoids the search text field when the editorial digest is
ready. The change is not deployed, so production savings remain unverified.

The digest writer audit also found stale list metadata after thread ratings and
prefix edits (plus projected counters touched by pending replies and poll edits).
Those mutations now refresh the existing digest in the same transaction; tests
exercise rating and prefix changes after the digest backfill has completed.

After deploying the digest writers and reader fallback, start the bounded
backfill on the intended non-production deployment with
`bunx convex run forumThreadDigestBackfill:run '{}'`. It processes 80 threads
per mutation and schedules continuation pages; check completion with
`bunx convex run forumThreadDigestBackfill:status '{}'` and wait for
`complete: true` before expecting export visibility checks to use this digest.
Only target production after an explicitly approved rollout. A completed
backfill is now a no-op if the start command is repeated, avoiding a second
full-table pass. The backfill has not been run in this workspace's deployment.

Large user-requested exports are read in bounded query pages inside the export
action, then combined into the same single artifact. The cursor and snapshot
time carry forward between pages; the action aborts if the publication epoch
or dataset selection changes mid-export. The overall record and scan limit
remains capped at 500, and each dataset row is still returned at most once
across continuation exports. A 100-record system snapshot uses up to four
25-record queries. The page size was previously raised from 25 to 50 to
halve action-level query calls, but a fresh read-only production Insights check
on October 2 found three `readExportDocuments` read-limit failures in 72 hours;
the newest read about 17.1 MB. The local action page size is therefore back to
25 as a conservative per-transaction mitigation. This can use up to 20 queries
for a 500-record export instead of 10 at page size 50. The production
invocations' input limit and deployed revision are not exposed by Insights, so
this is not proof that page size 50 caused those failures. Halving the page
size should lower per-query bytes for similarly distributed fan-out, but
provenance fan-out is uneven and actual savings are unmeasured. Continuation
cursors pin the document read model and compact forum-assessment visibility
mode, so later pages skip the migration-component status lookup. A legacy
cursor without the assessment flag resolves that mode once and includes it in
the next cursor. Large individual records or unusually wide provenance fan-out
can still exceed the per-query limit. Local tests cover multi-page exports,
the continuation cursor, and no duplicate or missing records. The mitigation
is not deployed, so a reduction in production read-limit failures is not yet
verified. Revisit larger pages only after the compact read-model migrations are
complete and production Insights confirms adequate headroom.

Balanced export continuation state can contain one native cursor per source.
Its new versioned base64url envelope preserves legacy URI-encoded cursors while
allowing a bounded 768 KiB continuation under Convex's per-value and
function-argument limits;
native cursors and source count are independently capped. A regression test
round-trips all 100 supported sources and verifies that a second page returns
the remaining records without duplication. This correctness fix is local and
not deployed.

Datasets with an empty source selection mean “all active public sources.” That
path still rejects catalogs over the 100-source bound for balanced exports,
which need the full source set to distribute records fairly and encode
per-source cursors. Recent exports with a page limit of at most 100 instead
resolve only the source IDs present in that page. Their lookup count is bounded
by the page size, so a sparse or large catalog no longer makes each recent page
read up to 100 unused source rows. Explicit source selections retain their
existing 100-source limit. Regression coverage verifies balanced over-limit
rejection and recent-page resolution across a 101-source catalog.

The owner newsletter analytics query is intentionally heavy: it inspects up to
30 issues, up to 2,000 delivery events and 2,000 engagements per issue, plus
bounds each linked story's save scan at 1,000 interaction rows until the
existing interaction aggregate backfill is complete. Once ready, the report
uses the maintained save aggregate instead of rereading those interaction rows.
The admin screen fetches a one-shot snapshot only after an explicit click, and
refreshes only on another click, so new events do not reactively rerun the
report while the page is open. The admin AI's routine newsletter-state tool no
longer invokes it; a separate editorial-performance tool is available when
the owner asks for those metrics. This avoids background refreshes but does not
make an explicitly requested snapshot cheaper; production impact has not yet
been measured. No write-side rollup has been added: Insights did not identify
this admin query as a hot path, and maintaining counters would add writes to
event/engagement ingestion. Revisit a rollup only if measured snapshot
frequency or read bytes outweigh that write amplification.

The batched `interactions.summaries` query accepts at most 50 entity IDs.
Previously each item independently read both aggregate-migration markers,
adding up to 100 repeated indexed reads to one request. It now validates the
public entities first, reads those two readiness markers once, and reuses the
same aggregate-versus-legacy decision across the deduplicated IDs. Viewer
interaction lookups remain per entity. At the request maximum this removes up
to 98 marker reads; the result path is covered both before and after aggregate
backfill. This is a code-shape bound, not a measured production saving, and
the change is not deployed.

### Compact evidence-version export metadata

The October 2 production sample read 5,733,843 bytes from 540
`evidenceDocumentVersions` rows during the oversized export query. Export output
uses version/provenance fields but does not use the version row's duplicated
title, excerpt, or searchable text. A new compact
`evidenceDocumentVersionExportDigests` table stores only the version metadata
required by that output. New versions write the digest atomically with the
canonical version. Export and shared visibility-owner lookups prefer a digest
and fall back to the canonical version row while old versions are being
backfilled.

After deploying the schema, writers, and dual-read fallbacks, run
`bunx convex run migrations:backfillEvidenceExportReadModels` on the intended
deployment and wait for the migrations component to report completion. This
resumable series backfills version, document, and assessment export digests in
order; rerunning it resumes incomplete work and skips completed migrations.
Add `--prod` only after an explicit production rollout approval. Each migration
processes 25 rows per transaction and is idempotent. Do not remove or narrow
canonical version fields: other agent, evidence, and search APIs still read
them. The backfill has not been run and this code has not been deployed; the
5.7 MB table read is a historical baseline, not a measured savings claim.
Recheck Insights after an approved rollout and compare the same export workload
before considering further schema cleanup.

### Compact evidence-document export metadata

The October 2 production sample also read 3,090,775 bytes from 561
`evidenceDocuments` rows during the oversized export query. The export record
does not use `searchText` or `canonicalUrlHash`, so the new
`evidenceDocumentExportDigests` table stores only the selection, publication,
and output fields it needs. Changed document upserts and first-party exposure
changes maintain this read model in the same mutation; other document APIs
continue using the canonical table.

New exports keep reading canonical rows until the
`backfillEvidenceDocumentExportDigests` migration is complete. Each export
cursor records which index issued its native pagination cursors, so an export
started during backfill continues on the canonical index even if the migration
finishes before its next page. Legacy cursors also remain pinned to canonical
rows. The combined `backfillEvidenceExportReadModels` runner also backfills this
table. Start it only after deploying the schema and writers, then wait for all
three migrations to complete. Do not add `--prod` without explicit production
rollout approval. The 25-row migration is idempotent; canonical document fields
remain intact. Dual-writing adds an indexed lookup and a digest write only to
changed document mutations, so compare that write overhead with same-workload
export Insights after an approved rollout. The 3.1 MB read is a historical
baseline, not a measured savings claim; this code has not been deployed and the
backfill has not been run.

The completed-migration gate is also the completeness invariant: the backfill
covers legacy documents, while every deployed document writer must update the
digest atomically with the canonical row. The export intentionally does not
fall back one-by-one when a digest is absent, since that would silently restore
the large-row read cost and mix pagination behavior. Any new document writer
must dual-write and add regression coverage before the digest read model is
considered complete.

### Compact research-assessment visibility metadata

The same October 2 export sample read 1,242,211 bytes from 428
`researchQualityAssessments` rows. Export visibility needs only the linked
thread's assessment status and author ID, not its bounded draft excerpt,
quality metrics, source domains, normalized terms, or flags. The new
`researchQualityAssessmentVisibilityDigests` companion row stores only the
assessment ID, thread ID, author ID, and status. Assessment creation, review,
content invalidation, and re-evaluation keep it synchronized in the same
transaction; re-evaluation removes the replaced digest before writing the new
assessment.

Only the export read path opts into this projection. It checks the migrations
component alongside the document-export migration once per export query, reads
the digest after backfill completion, and falls back to the canonical
assessment both before completion and if a digest is missing. Other research
and forum APIs keep their existing canonical reads. Regression coverage checks
both pre-backfill and missing-row fallbacks, confirms the completed projection
is used, and checks writer status changes and replacement cleanup.

The combined `backfillEvidenceExportReadModels` runner runs this projection
after version and document digests. Start it only after deploying the schema
and dual-writers, and wait for the migrations component to report completion.
Do not add `--prod` without explicit production rollout approval. The 25-row
backfill is idempotent; canonical assessment records remain intact. The
companion table and its two lookup indexes add storage and write overhead to
assessment mutations. The 1.24 MB assessment read is a historical baseline,
not a measured savings claim; this code has not been deployed and the backfill
has not been run. Compare the same export workload's bytes read and assessment
write overhead after an approved rollout before claiming net savings.

### Bounded forum revision evidence context

Forum revisions now select source sentences that overlap the previous draft's
source-linked claims and cap repeated article text at 1,800 characters per
source, down from the 6,000-character fetch bound. Titles, descriptions, the
previous draft, claim IDs, and gate feedback remain in the prompt. The
deterministic grounding gate still checks the full article snapshots after the
model responds. This bounds repeated revision context but is not a token or
provider-cost measurement; compare revision input tokens after an approved
deployment before claiming savings.

The Suki publication gate now requires complete coverage of detected
consequential body statements by a ledger claim whose own cited source has
matching lexical evidence and supports that statement's verifiable details.
An unrelated candidate can no longer validate a version or number by merely
containing it elsewhere in the prompt. Deterministic repair removes an exact
statement it cannot tie to one source; transformed leftovers block publication.
This is a local quality safeguard, not a measured model-quality improvement,
and has not been deployed.

Belle's newsletter revision prompt applies the same evidence discipline at a
larger source fanout: selected stories get claim-linked excerpts capped at
1,800 characters, while unselected alternatives retain their titles and
descriptions but only 450 characters of article text. First-pass prompts are
unchanged, and post-revision scoring still uses the full snapshots. At the
weekly source limit this reduces the repeated article-text ceiling from about
89.6k to 23.4k characters; that is a prompt-size bound, not a measured token or
provider-cost result.

### Bounded evidence-research prompts

Evidence research retrieves at most ten public documents, but a stored excerpt
may be 8,000 characters. The generation prompt now selects query-matching source
sentences and caps each excerpt at 2,400 characters (24,000 excerpt characters
across ten sources, versus an 80,000-character prior ceiling). Matching
sentences remain in source order; when no query terms match, the helper uses a
bounded prefix. The full excerpts remain in the returned source metadata.
Generated briefs are accepted only when every non-heading paragraph has a
numeric citation, every cited index maps to a supplied source, and each cited
source clears a deterministic lexical-support threshold for its paragraph or
list item. Verifiable numeric details must also appear in every cited source.
Otherwise, usage is still settled and the job returns the deterministic
extractive brief without making another model call. This improves source
attribution but is not semantic entailment proof; ambiguous paraphrases may be
rejected and unsupported claims sharing the same vocabulary can still pass.
These are tested code-path bounds, not measured provider-token savings or an
output-quality benchmark.

### October 2 cron and canary review

A read-only production usage snapshot at 2026-10-02 14:01 UTC showed 11,935
function calls, 0.1053 GB database I/O, 0.3353 Query-GB of search queries, and
0.0271 GB egress for the current day so far. The partial October month showed
30,779 calls, 0.2383 GB database I/O, 0.7467 Query-GB, and 0.0440 GB egress.
Convex AI Gateway spend was $0 in both counters; this app calls OpenRouter
directly, so that is not a measure of its provider spend.

A prompt-free read-only aggregate of the preceding 24 hours found 87 model
route attempts, 43 failures, and 27 fallback attempts. The free route had 56
attempts and 28 failures; `deepseek/deepseek-v4-flash-0731` had 31 attempts and
15 failures. Coarse, server-side-only error classification grouped failures
into 22 timeout/network errors, 16 structured-output errors, and 5 other reply
errors; no raw error text or prompts were returned. There were 30 completed
usage events (112,956 input and 44,960 output tokens): 10 topic selections, 6
drafts, 2 replies, and 12 embeddings. The seven DeepSeek usage rows had zero
recorded estimated cost, and all 87 route attempts lacked usable cost
attribution, so actual OpenRouter spend cannot be established from this
deployment snapshot. These are pre-change production readings; the local
shared spend reservations and improved telemetry are not deployed.

An earlier October 2 read-only check found all 30 roster agents enabled with a
positive daily target. `FORUM_AGENT_DAILY_PUBLICATION_LIMIT` is set to 42,
while the cadence helper clamps it to the 37 defined daily slots, so the roster
cron fan-out is intentional rather than dormant work. The fresh sample shows
32 `model-route-canary` route attempts, including 7 structured-output failures
on the initial route and 7 successful fallback attempts. The canary is an input
to a two-hour publication freshness gate; reducing its hourly cadence without
a reliable cost ledger and an availability policy would risk blocking or
delaying publications. No cadence or cron change was made from this sample.
Attempt-level durations add a separate latency signal: failed forum-agent
routes averaged 110 seconds (max 270 seconds), failed Hacker News routes
averaged 183 seconds (max 300 seconds), while the 7 failed canary attempts
averaged 15 seconds (max 26 seconds). The two successful Hacker News attempts
lasted about 146 and 263 seconds, so a blanket timeout reduction would cut
observed successful work as well as failures. Keep timeout changes stage-specific
and evaluate them against successful latency and the publication gate.
The owner telemetry snapshot now reports route and usage events whose costs
cannot be attributed to a known price, and warns when its bounded event sample
hits a row cap. This uses the route and usage rows the snapshot already reads;
it adds no database query. A known free route remains distinguishable from an
unpriced paid route. Tests cover both cases. This observability improvement is
local and has not been deployed, so the production zero-cost entries remain
unresolved until a later rollout/readback.

A later prompt-free read of the preceding 24 hours found seven failed
`forum-revision` route attempts and no completed revision attempt in that
sample: four failures on `openrouter/free` and three on the DeepSeek fallback.
Their mean durations were about 119 and 121 seconds respectively, with a
210-second maximum. These are route attempts, not necessarily seven separate
agent runs, and they still have no usable cost attribution. The one-pass
editorial gate remains fail-closed; the local source removes its unreachable
second-pass rescue branch without changing the pass limit, fallback candidates,
or publication threshold. Do not shorten the revision timeout or publish an
unrevised draft from this small failure-only sample; compare later completion
rates and successful latency after an approved rollout.

A follow-up server-side-only 24-hour aggregate at 2026-10-02 16:58 UTC covered
100 route attempts (not capped): `openrouter/free` had 33 completions and 32
failures; the DeepSeek alias had 17 completions and 18 failures, with 31 of its
attempts marked as fallbacks (15 completed, 16 failed). A coarse classification
of the 50 failures found 27 timeout/network, 18 tool-call, and 5 other errors;
no raw error strings were returned. All 35 paid-alias attempts still had zero
recorded cost, so this is not a provider-cost estimate. The owner telemetry
model table now distinguishes fallback yield from total model failures using
the same bounded route rows and no additional database reads. Keep timeout
budgets unchanged until cost attribution and completion/quality tradeoffs can
be compared after an approved rollout.

### OpenRouter fallback price correction

The OpenRouter page for the configured `~deepseek/deepseek-v4-flash-latest`
alias listed $0.005775 per million input tokens and $1.60 per million output
tokens when rechecked on October 2, 2026. The previous local price table used
$0.05 input and $0.16 output: it overestimated input cost but understated
output cost by 10x. The shared spend ledger now uses the live listed rates,
with tests that pin input-only, output-only, and mixed-token estimates. These
are provider-list prices, not a reconciliation of actual invoices; the
correction is local and undeployed, so production's zero-cost route entries
remain unresolved until an approved rollout and readback.

A prompt-free seven-day production aggregate at approximately 2026-10-02
20:31 UTC found 839 route-attempt rows (not capped): `openrouter/free` had
254 completions and 275 failures; the DeepSeek fallback alias had 157
completions and 153 failures. Across all routes, the coarse failure classes
were 160 timeouts, 174 structured-output errors, 79 other errors, and 15
provider errors. These are candidate attempts, not counts of failed agent
runs. Timeout attempts averaged about 144 seconds on the free route and 148
seconds on DeepSeek; leave stage budgets unchanged until successful and failed
latency are compared per stage after rollout.

The same seven-day usage sample had 354 receipts, 1,574,139 input tokens, and
768,329 output tokens, with no missing token counts; the ledger reported only
$0.000855 estimated spend, mostly embeddings. Ninety receipts named
`deepseek/deepseek-v4-flash-0731` but each recorded zero estimated cost. Those
rows account for 625,714 input and 347,020 output tokens; applying the
configured latest-alias list prices gives an approximate $0.559, not a verified
invoice total. Before the local changes, generation writers stored the resolved
response model ID in `model`, while the price table only had the configured
latest alias; that mismatch explains the zero estimates on the concrete
DeepSeek IDs. The current local settlement path keeps requested and served
model IDs separately and normalizes non-free served IDs to the priced alias; a
regression test now covers this exact production-shaped response. This remains
undeployed, and no historical production rows were rewritten.

A separate seven-day read counted 134 agent runs and 194 selected-source rows;
50 source keys were selected more than once, and 20 repeat selections occurred
within 90 minutes. The agent research path fetches selected article pages after
reserving sources, while the newsletter-to-Belle digest path already passes
reusable snapshots directly. A global persistent page cache would add a cache
read to every agent run to avoid at most these 20 observed short-window repeats
(source-key overlap is only a proxy for canonical-URL fetches). That trade is
not yet justified against Convex read cost, extra retention policy, and stale
evidence risk, so no global cache was added. Reassess if source-fetch telemetry
shows higher repeat volume or measurable network latency.

The telemetry page now requests that snapshot once on entry, when the selected
time window changes, or when the operator presses Refresh. It no longer keeps a
reactive subscription over the high-churn route/run/reply/usage tables. The
snapshot query is bounded but can read up to 2,738 rows across its current
table caps, so this avoids repeat aggregate reads while the page is open; it
does not reduce the cost of an explicit refresh. No production read-frequency
measurement is available yet.

The admin analytics page now uses the same point-in-time pattern: summary and
web-vitals data load on entry, day-window changes, or explicit refresh; the
day-independent SLO snapshot reloads only on entry or explicit refresh; and
event-source/type filters reload only the bounded 100-row event list.
Previously, the analytics summary could read up to 2,500 events and the
web-vitals summary up to 5,000 samples on every matching table write while the
tab stayed open. This removes those reactive reruns but retains the per-snapshot
read size; production frequency and savings are not measured.

Revision lift now shows its measured sample count and the share of revisions
with a positive score change. With no measured before/after pair, the card shows
an unavailable marker instead of implying a zero-point result. These metrics
reuse the already-read bounded usage events; they add no database query and do
not change when the agent decides to revise.

### In-run article fetch deduplication

The Suki forum, Belle digest, and newsletter pipelines now share a batch
snapshot fetcher that requests each canonical article URL at most once per run.
When separate Hacker News submissions point to the same article, the fetched
page text and metadata are reused while each candidate keeps its own story ID,
source key, title, summary, URL, and fallback values for citation and selection.
This cache is scoped to one action only: it adds no persistent article-content
storage and makes no cross-run freshness assumptions. Duplicate URL frequency
and avoided requests have not yet been measured, and the change is not
deployed.

The scheduled daily and weekly newsletter workflows now also pass their
bounded extracted article snapshots into the immediately-following Belle
Hacker News forum digest. The digest reuses only canonical-URL matches, while
rebuilding each forum candidate's own identity and fallback text. This avoids
re-fetching overlapping source pages across those two actions without adding a
database table, read, or write. Runs started outside those orchestrations still
fetch their own pages. The cross-action overlap and avoided requests have not
been measured in production; this change is local and undeployed.

The daily action returns only the first 12 snapshots Belle will read rather
than all 18 fetched by the newsletter editor; weekly retains its bounded 28
candidate packet because it can overlap a different, current-day snapshot.

For the daily edition, newsletter generation also passes Belle the compact
ranked metadata for the same first 12 Hacker News stories it already read.
Belle rechecks the snapshot's completion timestamp and falls back to its normal
story query if the snapshot changed or the handoff is incomplete. On an
unchanged snapshot this replaces the duplicate 12-row story read with a
metadata-only snapshot lookup; it adds no function call and carries only
bounded summaries plus ranking fields. Production frequency and byte savings
have not been measured, and the change is local and undeployed.

Belle's digest now fails closed unless its 12 briefs map one-to-one to the 12
selected Hacker News stories. Deterministic checks reject numeric/version/CVE
details absent from the matching story extract and unsupported shared
opening/closing precision. Claims with insufficient lexical coverage are
recorded as partial rather than fully supported; partial analysis may pass as
an inference only when it adds no unsupported verifiable detail, while facts
must meet the normal support threshold. Only then can an optional image be
cached. This is a local quality gate, not a model-quality or savings
measurement, and has not been deployed.

### Heartbeat-driven online summary

The forum index previously subscribed reactively to `onlineSummary`, which
reads the bounded presence room, each active member's user row and location,
and up to 18 profile rows. Presence heartbeats and route changes can invalidate
that same summary for every open forum index. It now fetches a point-in-time
snapshot on entry and refreshes while the tab is visible every two minutes
with a small random stagger; returning to a visible tab refreshes immediately.
The snapshot may therefore be about two minutes stale, which is acceptable for
this informational widget. This trades write-driven invalidation fanout for
one bounded read per visible client per interval. Production heartbeat-to-query
frequency and resulting savings have not been measured; the change is local
and has not been deployed.

### News timeline hydration

The news route already fetches a cached timeline on the server and passes that
snapshot to the client. The browser now skips the duplicate reactive timeline
query when that initial snapshot exists; it subscribes only after a reader
selects a different snapshot. If server hydration has no timeline, the browser
still queries the latest timeline to preserve recovery behavior. This avoids
one redundant read and the default 60-snapshot subscription per hydrated page
view. Actual traffic and savings are not measured, and the change is local.

### Admin overview snapshot

The admin overview reads capped samples across posts, users, subscribers,
newsletter issues, analytics events, contact requests, logs, and other tables.
Previously that reactive query remained subscribed while an administrator
worked in any admin tab, so unrelated changes (especially new analytics
events) could rerun the whole multi-table read. It now loads once when Overview
is opened and exposes an explicit Refresh snapshot action; leaving Overview
stops further invalidations. The Posts tab uses the posts list it already
loads for its published/total figures. This reduces repeated reads while the
overview is open and avoids the overview read on other tabs, but the query's
initial bounded read remains unchanged. Production refresh frequency and
savings have not been measured; the change is local and undeployed.

The overview now calls these values `sampleCounts` instead of `totals`, because
they are counts from bounded recent/index-ordered samples rather than exact
table totals. Its reader, subscriber, and analytics samples were each reduced
from 500 rows to 100; the role-based user count is capped at 100 per role.
The command center and navigation label them as samples. This removes up to
1,200 document reads from an overview refresh, but exact savings depend on how
often the snapshot is opened and are not measured in production.

### Online-member roster presence reads

The dedicated online-members page reads up to 120 presence-room entries,
validates their user and location rows, then loads profiles for the visible
25-member page. Its former reactive subscription could rerun that bounded
read on heartbeat and route-location updates from any active member. It now
refreshes a page-specific snapshot on entry/page change, when the tab returns
to the foreground, and about every two minutes while visible; refreshes are staggered
to avoid synchronized polling. The 15-minute online window remains the same,
and the UI shows snapshot freshness and reports a failed refresh without
discarding the last successful page. This trades immediate updates for bounded
refreshes, but actual heartbeat-to-query frequency and production savings are
not measured; the change is local and undeployed. The forum index summary and
online roster now share `useForegroundSnapshot` for interval scheduling,
jitter, cancellation, visibility changes, freshness, and refresh-error state.

### Scheduled-agent run preflight

Publication preflight already reads the bounded per-agent/day run range to
enforce each agent's daily target. It now reuses that same range for the
requested run-key check when fewer than 40 rows were returned, avoiding a
second point lookup in the normal complete-range case. If the range reaches
its cap or contains ambiguous duplicate keys, it keeps the indexed point
lookup as a correctness fallback. This removes one indexed read from typical
slot checks without weakening idempotency; production call volume and savings
have not been measured. A duplicate published-slot recheck may read the
per-agent/day range before it exits, rather than the old one-row point lookup;
compare that frequency against new-slot checks in post-rollout Insights before
expanding this pattern. Missing, disabled, and zero-target agents now exit
before reading the shared structured-canary state. This preserves dynamic
admin activation with static schedules while avoiding one indexed read per
dormant scheduled slot; current production dormancy and savings are unmeasured.

### Batch the shared RSS research cache

The shared research collector checks 14 feed-cache keys for each agent run.
Previously it made one internal query call per feed and, when entries were
expired, one internal mutation call per refreshed feed. It now reads all cache
keys in one bounded query and writes all refreshed entries in one bounded
mutation, while RSS requests remain parallel and each feed retains its 90-minute
TTL. This saves 13 Convex function invocations per cache check and up to 13
more on an all-feed refresh; it does not reduce the underlying indexed row
reads. A cache-write failure now leaves successfully fetched candidates
available to the current run rather than discarding that feed's data. Tests
cover cached reads, batched writes, and cache-write failure behavior. These
changes are local and undeployed; production invocation savings are unmeasured.

### Evidence writer projection reads

`evidence:upsertDocumentVersion` now reuses the evidence source and known
document values already read or written in its mutation when maintaining the
universal-search projection. It no longer fetches a newly inserted document
back, re-fetches the document after patching, or reads the same source again.
Visibility changes similarly build the projected document from the row already
read plus the patch fields. This removes up to three redundant document/source
reads for a new upsert and two for a version update, without changing the
transactional projection or visibility checks. Mutation frequency and observed
database savings have not been measured; the change is local and undeployed.

### Avoid duplicate Hacker News digest dispatch

The standalone Hacker News refresh still schedules Belle's daily digest for
the scheduled refresh cron. When the daily newsletter itself has to refresh the
snapshot, it now suppresses that follow-up because the same workflow invokes
Belle directly with the article snapshots it just generated. Belle's run-key
claim already prevents a second model generation, but the extra scheduled
action could still repeat setup, snapshot, and claim reads (and article fetches
if it wins the claim race). This removes that redundant dispatch only from the
orchestrated newsletter path; production frequency and savings are unmeasured,
and the change is local and undeployed.

### Reuse the scheduled Hacker News snapshot for daily editorial

The daily newsletter previously refreshed Hacker News even though a scheduled
snapshot runs earlier the same local day. It then read up to 40 full story rows
only to obtain the snapshot date; Belle's generation action immediately read
its own bounded set of 18 source rows. Scheduled, non-forced runs now reuse a
completed same-day snapshot younger than three hours using a metadata-only
query, and the generation action performs the one required source-row read.
Manual/test/forced runs and missing, empty, incomplete, or stale snapshots keep
the refresh path. The three-hour ceiling covers the scheduled refresh at 11:05
UTC and the default 07:15 America/Chicago newsletter time across standard and
daylight offsets; article text is still fetched during generation. This can
avoid one duplicate HN fetch/write cycle and up to 40 full story reads per
scheduled run. Production adoption and savings are unverified; the change is
local and undeployed.

### Semantic-index completion settlement

Successful evidence embedding previously used one mutation to settle the
provider reservation and a second mutation to mark that exact document revision
as indexed. Settlement now writes both records atomically, eliminating one
internal mutation call per successful index attempt and preventing a split
state where spend is settled but the completion marker is missing. Failed or
ambiguous provider attempts still never create a successful index marker.
Provider-call savings and database impact remain unmeasured; this change is
local and undeployed.

### Keep newsletter webhook rows normalized

The Resend webhook handler stores the fields used for deduplication, issue and
subscriber attribution, and editorial analytics. It no longer copies the
truncated raw callback JSON into every `newsletterEvents` row: no application
reader used that field, while open/click payloads can include IP addresses and
user-agent strings. This reduces the size and retention of future event rows
without migrating legacy data or changing the event-counting API. The actual
byte savings depend on provider payloads and event volume and have not been
measured. For callbacks tied to a known newsletter broadcast, the handler now
uses that issue match to avoid the otherwise unnecessary indexed
`contactRequests` lookup; unclassified callbacks retain the existing contact
delivery fallback. The number of avoided lookups has not been measured.

The owner-only editorial snapshot also avoids its event/engagement index
lookups for draft, scheduled, and cancelled issues, which cannot receive public
engagement. Sent and failed issues retain both bounded reads so partial sends
are still represented. This removes two empty indexed lookups per skipped
issue; the admin panel loads the snapshot only on explicit request, and live
frequency remains unmeasured.

The explicit newsletter analytics snapshot now reads exact delivery and
engagement counts from a namespaced `@convex-dev/aggregate` instance once both
backfills complete. The old bounded-row path remains active before then. Live
tracked webhook and engagement inserts update the aggregate in the same
mutation, and `insertIfDoesNotExist` makes the transition backfill idempotent.
This replaces up to 120,000 source-row reads in a 30-issue query with 300
batched aggregate ranges. The aggregate adds synchronous component writes and
storage for each tracked event, so it is an availability/scaling tradeoff, not
a proven net cost reduction. Production Insights has not attributed an error
to this manually loaded query and does not report successful-call volume; the
backfills and component are local only and must be deployed/run before the
aggregate read path activates.

The forum index now distinguishes an online-summary snapshot that is still
loading or unavailable from a successful snapshot with zero members. It shows
an explicit loading/unavailable state and retry action instead of presenting a
temporary failure as `Online 0`; after a refresh error it retains the last
successful count and labels it stale. The two-minute foreground refresh cadence
is unchanged, so this corrects the signal without adding queries or polling.

### Drop write-only AI telemetry indexes

The bounded admin and retention readers use `createdAt` indexes for both
`forumAgentUsageEvents` and `aiRouteEvents`; no runtime reader used the other
five secondary indexes on those event tables. Removed two unused usage-event
indexes and three unused route-event indexes. New AI events now maintain only
the time index needed by dashboards and cleanup, while the event rows and
retention behavior are unchanged. This removes five secondary index entries
across the two inserted telemetry rows for a successful routed generation
(route attempt plus usage receipt); failed or free-only calls avoid some of
those rows already. Row volume and byte savings have not been measured, and
this schema change is local and undeployed.

### Read only requested newsletter settings

The 15-minute newsletter schedule check and the newsletter generation config
loader previously scanned up to 100 `newsletterSettings` rows, even though
they need four and at most 20 known keys respectively. Both paths now use the
existing unique `by_key` index and fetch only distinct requested keys. This
avoids loading unrelated settings without adding Convex calls or changing
defaults. The live table size and resulting read savings have not been
measured; the change is local and undeployed.

### Batch aggregate reads for content summaries

The multi-entity content summary query supports up to 50 entities. Once the
interaction and comment aggregate backfills are complete, it now uses the
aggregate component's batch-sum API for scores, saves, and comments instead of
issuing three component queries per entity (up to 150 for one request). The
newsletter analytics helper similarly batches save counts for each issue's
stories. The bounded raw-row fallback before migration is unchanged. This
reduces internal aggregate-query fan-out without changing the client API or
results. The aggregate still traverses a bounded B-tree path for each
namespace, so this reduces component function invocations but not necessarily
the underlying aggregate-node reads. Request frequency and live savings have
not been measured, and the change is local and undeployed.

### Fence public source status changes

The admin source-status mutation now treats an active-to-paused transition on a
public source as a publication restriction: it advances the same publication
epoch used to invalidate export and research artifacts, and requests the
universal-search visibility rebuild in the same transaction. Reactivation
keeps the existing bounded source-index enqueue. Repeating the current status
is now a true no-op, avoiding a semantic `updatedAt` change that could stale
source-bound vectors without enqueuing reindexing. These corrections are local
and undeployed.

### Use schema-constrained JSON for one-shot agent outputs

A privacy-safe seven-day production aggregation (approximately 2026-10-02
20:54 UTC) found repeated route failures whose stored error strings contained
both `tool` and `required`: 24 of 35 free-router and 1 of 14 DeepSeek topic
selection failures; 40 of 60 free-router and 5 of 38 DeepSeek draft failures;
and 36 of 47 free-router and 7 of 36 DeepSeek revision failures. Timeout/abort
terms also appeared in 10 and 12 topic, 20 and 30 draft, and 10 and 29
revision failures respectively. These are overlapping keyword counts on
candidate attempts, not exclusive failure classes or end-to-end run counts;
raw provider messages and prompt text were not returned.

Suki's topic, draft, and revision generation plus the shared structured-route
canary now request AI SDK `Output.object` schemas instead of requiring a
one-shot function-tool call. The final Zod schemas and editorial/research gates
remain authoritative, and route fallback remains in place for invalid or
failed outputs. OpenRouter structured-output support is enabled in the
OpenAI-compatible provider configuration. A mocked provider integration test
confirms the route sends strict JSON Schema. This can avoid failures caused by
models not selecting the required tool and the subsequent paid fallback, but
the change is local and undeployed; post-rollout route counts, spend, latency,
and publication quality are not yet measured.

A follow-up privacy-safe seven-day production aggregation (approximately
2026-10-02 20:58 UTC) found the same tool-required error signature in Belle's
one-shot outputs: Hacker News digest had 29 free-router and 32 DeepSeek failed
attempts, with 15 and 0 matching the tool-required pattern; daily newsletter
had 10 and 11 failures, with 5 and 3 matching; the two weekly attempts both
matched. Timeout/abort terms appeared in 13 free-router and 31 DeepSeek digest
failures, and 5/8 daily-newsletter failures. These are attempt-level,
overlapping keyword counts, not exclusive failure causes or end-to-end run
outcomes; raw provider errors and prompts were not returned.

Belle's Hacker News digest and daily/weekly newsletter writers now also use
AI SDK `Output.object` with their existing Zod schemas instead of a required
single tool submission. The schemas are still parsed server-side, and the
existing grounding, source-selection, and publication-quality gates remain in
place. A mocked OpenRouter integration test now exercises `ToolLoopAgent` and
asserts strict JSON Schema without a `tool_choice` requirement. This remains a
local, undeployed change; route retries, spend, latency, and publication
quality must be measured after rollout before claiming a production benefit.

### Constrain forum-reply decisions with a schema

A privacy-safe seven-day aggregation (approximately 2026-10-02 21:09 UTC)
found 74 failed forum-reply attempts across 25 operations. A sanitized error
pattern classified 18 free-router and 15 DeepSeek failures as invalid decision
output; 9 more matched publication-quality failures, 3 timeout/abort, and 29
did not match those patterns. These are attempt-level keyword categories, not
independent causal diagnoses or operation outcomes; raw provider errors and
prompts were not returned.

Forum replies now use the durable agent component's `generateObject` with a
discriminated Zod schema for `ignore` or `reply`, including bounded reason and
reply-body fields, instead of asking the model to emit XML tags or repair
free-form JSON. Existing publication-hygiene, source-grounding, and final
publication checks remain in place. This should remove parser failures caused
solely by formatting drift, but the change is local and undeployed; post-rollout
failure rates, spend, latency, and publication quality are not yet measured.

### Disambiguate scheduled reply retries in route telemetry

A fresh bounded production read over the same seven-day window found 92
forum-reply route attempts across 25 operations. The route-level attempt number
restarted at 1 on each scheduled retry, so 17 operations had duplicate attempt
ordinals and fallback events could not be separated cleanly from a later
primary retry. The reply-run records also showed nine runs that replied at
retry index 1 and one that was ignored at retry index 2. Because retries
recovered outcomes, their cadence is unchanged.

The reply sweep now offsets route attempt ordinals by the two configured model
candidates for each scheduled retry, while the `fallback` flag remains local to
the current candidate sequence. Telemetry can therefore distinguish primary
and paid-rescue calls in retries without changing provider selection or call
count. The local change still requires deployment before its effect can be
observed in production.

### Commit reply terminal outcomes with run state

Reply publication, ignored decisions, and failed attempts now write their
private sweep outcome event in the same mutation that updates the reply-run
state (and, for publication, creates the post). This removes the follow-up
Convex mutation call on those terminal paths and prevents a committed terminal
state from being separated from its outcome event. Provider-usage settlement
remains its own preceding operation. The invocation reduction is inferred
from the local call path; production frequency and savings are unmeasured, and
the change is not deployed.

Unclaimed reply sweeps now record their private outcome inside the candidate-
claim mutation as well, rather than making a second mutation after the claim
returns. The event write is preserved, with the same outcome mapping, but is
atomic with the decision that produced it. This removes one function call per
unclaimed sweep; production frequency and savings are unmeasured, and the
change is not deployed.

### Reclaim vectors after evidence leaves the public corpus

Semantic candidate hydration already rechecked the current evidence document
and source before returning a result, so stale vectors were not themselves an
authorization bypass. They could, however, remain stored in the RAG namespace
and occupy part of the bounded semantic candidate window. Document retractions
and public-source pauses now enqueue serialized, bounded cleanup workflows.
Each cleanup action rechecks document and source visibility immediately before
deleting by the stable document key, then clears a matching model-specific
completion marker. This matters especially for source pauses, where document
revisions do not change and later re-indexing must not be skipped.
The RAG delete path makes no embedding-provider request and incurs no model
spend; its Convex component-call frequency and any search-quality effect have
not been measured.

The one-time `internal.semanticSearchIndexWorkflow.startStalePublicEvidenceVectorCleanup`
mutation is available to reconcile vectors made private before these lifecycle
hooks existed. It scans document IDs in small pages, checks for an existing
namespace before scanning, and rechecks eligibility during deletion. Run it
once after deploying the cleanup code if legacy stale vectors should be
reclaimed. Re-publication remains subject to the existing semantic-index
feature switches and spend reservation; cleanup does not enable paid embedding
work. No production cleanup or deployment was run as part of this local change.
