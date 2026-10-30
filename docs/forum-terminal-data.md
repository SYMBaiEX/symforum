# Native terminal data boundaries

## Discovery

The public terminal is a **sampled watch**, not an exhaustive price index or a
tick feed. The existing two hourly token scouts remain on their original
schedules and allowances. Each ordinary ranking request rotates a documented
Solana Tracker `minMarketCap`/`maxMarketCap` segment. This changes the existing
request, not its frequency. Requests still reserve and count the same free-tier
allowance, including failures and the existing bounded retry.

The five eligible, fresh, on-chain-verified candidates are copied into an
allowlisted display cache before model selection. Actual market capitalization
is never substituted with FDV. Local half-open cap validation excludes the
provider's inclusive upper boundary. Source rank is within the eligible segment;
the published post retains that limitation. Diagnostic probes do not update
this feed or notify watchers.

`forumTerminal.listMarket` takes `now`, optional band/platform and a hard maximum
of 60 rows. `getMarket` serves exact-case mints. Display cache retention is 24h;
freshness is 15min. Row timestamps remain visible even when the list contains a
mix of sample ages. Neither endpoint authorizes a swap. The existing verified
mint-resolution, quote, simulation and wallet-signature path remains mandatory.

## Private wallet and watches

`getWalletReadState` requires a verified, linked human wallet. It reads finalized
SOL plus the configured SYMF mint and optionally one selected mint. Every actual
RPC is reserved against the unchanged commerce 1,000/day cap and the tighter
terminal 100/day sub-budget. Cached requests share one wallet lease, even when
selection changes. Refresh cannot exceed once per minute; failures retain the
last checked timestamp instead of fabricating zero balances. Frozen holdings
can be displayed but are not advertised as spendable.

There is deliberately no guessed SOL “Max”: before a particular message/route
exists, exact fee/rent headroom has not been proved. `maxSolRaw` and
`feeReserveLamports` remain null. Existing preparation rechecks solvency and
simulation before a wallet request.

Watchlists are private, exact-case mint keyed and limited to 50 per account.
Optional positive upper/lower USD thresholds create private in-app alerts on a
real crossing between **sampled hourly observations**. The first observation is
a baseline, not a trigger. Saved observed timestamps prevent duplicate alerts;
stale or superseded ingestion cannot emit them. No X/Telegram/email send, model
call or polling schedule is introduced.
Alerts expire after 30 days; existing ingestion prunes at most 50 expired alert
rows per call. Historical payment receipts and uncertain holds are never pruned.

## Risk facts

`getRisk` returns only previously checked public mint facts. A linked owner can
explicitly call `refreshRisk`, which shares a 10min mint cache and uses one
reserved finalized RPC read. Facts include token program, mint/freeze authority
and unsupported transfer-related extensions. Unknown or stale data remains
unknown/stale. No “safe token” score, holder-concentration audit, LP-lock claim or
investment rating is inferred from those checks.

## Treasury and burn transparency

The same transaction that records a verified promotion receipt copies only its
mint, treasury, exact raw amounts, signature and verification time into a public
projection. Source wallet, account identity, drafts, errors and held operations
are not exposed. A payment can be verified while its placement remains held;
the original hold is preserved, while actual funds are counted truthfully.

Projection keys are immutable promotion intent IDs. Counters are updated
atomically and partitioned by historical mint and treasury. The public page
shows the configured mint/treasury only, recent 20 receipt links and exact
recorded totals. It does **not** infer platform swap fees or a complete treasury
wallet balance.

`forumTerminalTransparency.backfillPromotionReceipts` is an internal, explicit
50-row-page metadata-only migration for historical verified receipts. It sends
no RPC/payment requests and changes no source statuses or holds. Until its
checkpoint is complete, `historyComplete:false` prevents all-time claims.

`forumTerminalData.backfillTrackedMarkets` can seed the display cache from up to
50 existing published tracked-token snapshots per explicit call. It copies only
validated snapshots from the last 24h and preserves their original timestamps.
No fetching, model invocation, alert, publication or payment is triggered.

## Integration

Register `forumTerminalTables` from `forumTerminalSchema` additively in the root
schema. Generate API types for `forumTerminal`, `forumTerminalData`,
`forumTerminalWallet` and `forumTerminalTransparency`. There are no new cron
definitions, environment variables, signing keys or paid subscriptions.

Official filter contract:
[Solana Tracker search](https://docs.solanatracker.io/data-api/search/token-search).
