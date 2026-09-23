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
