# Forum terminal UI

## Integration contract

`ForumTerminal({enabled, initialMint?, renderUtilities?})` is the first-party trading surface.
`renderUtilities(mint)` is the integration slot for `ResearchPurchase({mint})`
and `CommunityHub({mint, compact?})`; those feature lanes own their payment flows.
The standalone route is `/trade` (mirrored for the forum and platform apps).
Embedded/native hosts render a first-party link, not wallet execution.

Market metadata remains display-only. The selected mint passes through the
existing authenticated `forumCommerce.resolveMint` before `TokenSwap` mounts.
The existing shared identity, Wallet Standard client, quote comparison,
simulation, signing, delivery and uncertainty protections remain the only swap
path. This UI adds no send or recovery method.

`TerminalPage` reads the mint query only in its website child, under the shared
route's Suspense boundary. A single exact 32-byte Solana address selects that
mint; missing parameters use the configured default. Empty, malformed or
duplicate parameters render an alert before any terminal/wallet/chart mounts,
never an executable default-token fallback. The platform redirect preserves
valid mint intent and forwards invalid intent to the same fail-closed page.
Indexed metadata may supply display identity; it never authorizes trading.

Public APIs are typed in `components/trading/terminal-api.ts`; the integrated
release must verify these references against the generated backend contracts.
Owner data is mounted only for a signed-in account. Wallet balances additionally
require a currently connected, server-linked wallet. Wallet reads occur once on
selection and on explicit refresh, not in a periodic per-viewer RPC loop.
Unavailable spendable SOL is never presented as Max.

## Market freshness

The generic chart uses `/api/token/[mint]/chart?interval=15m`. Its existing
`{mint,pool,interval,checkedAt,candles}` contract optionally carries `stale`,
`priceUsd` and `{marketCap,fdv,liquidity,volume24h}` stats. The browser validates
the selected mint, interval, finite values, sorted unique timestamps and candle
envelopes before display. Fresh chart stats take precedence over the older
discovery sample; a fresh null market cap stays unavailable even if FDV exists.
Sampled holders and one-hour volume/change retain their own observation time.

Chart refresh is one minute while visible. Discovery/watch alerts use existing
scheduled samples, not a real-time or exhaustive feed. Individual stale samples
are marked. Price alerts are in-app, not promised external notifications.

Ordinary hourly scout invocations first run a separately fenced, data-only
observation. This can refresh Markets while an unresolved model operation keeps
drafting and publishing blocked. Admitted drafting reuses that exact observation
instead of buying another ranking read. See [market observation](forum-market-observation.md)
for quota, fencing and retention details. Source timestamps, not page refresh
times, determine freshness; hourly coverage is fresh for 15 minutes and retained
for display for 24 hours with explicit stale labels.

Treasury totals include only confirmed recorded promotion receipts. Incomplete
historical projections are explicitly labeled; neither pending payments nor
estimated swap fees are counted.

## Design assessment

The primary path is
token selection, mint/metrics/chart, then the adjacent wallet-approved swap.
Research/discussion belongs with market context; private balances/history and
alerts follow below. The existing forum's Geist typography, neutral surfaces,
magenta selected states and restrained teal chart marks remain unchanged.

The terminal alone opts out of the forum's reading-width cap. The connected
desk has one flexible analytical pane and a persistent 328px order column,
separated by a thin rule. Accessible Chart/Markets tabs switch only the mounted
analytical panels. The former permanent discovery rail and card implementation
are removed; shared token identity/logo primitives live in `market-identity`.
On smaller content widths the order panel stacks below, with a visible Trade
link transferring keyboard focus to it. Desktop candles occupy 380–420px of
height, with 272px when the desk stacks. The asset header and metric strip are
compact; intervals, candle close and checked time share one toolbar. The actual
chart frame spans that grid, not just its nested drawing element. Small screens
retain a single-row header and 44px touch controls; extremely narrow chart
toolbars wrap rather than clip financial values. Markets uses content-driven
height instead of reserving an empty 620px panel.
Primary price,
market cap, liquidity, 24h volume and sampled hourly change lead; secondary
metrics, public sources and exact timestamps remain in Market details. The
visible status line still labels stale hourly change. Mint facts follow the
trade panel, without hiding operation receipts. Tabs and disclosures preserve
mounted children rather than restarting data or payment components. An adjacent
forum discussion bar uses the indexed canonical thread or, for the exact
configured SYMF mint only, its configured announcement path.

The Markets view is a semantic, sortable table of retained scout samples, not
a market-wide leaderboard. It uses the same bounded query and minute buckets
as the replaced rail. Search and sort are local; cap/platform filters retain
their existing query contract. Missing/invalid metrics sort last in both
directions, with actual market cap never replaced by FDV. Safe source links,
observation timestamps and per-row stale labels remain available. The table
has a named keyboard-scrollable region and sticky identity/header cells.
There is no fabricated top-trader PnL, order book, live trade feed or unsupported
indicator toolbar. Research, community payments and owner receipts stay outside
the analytical tabs.

Overflowing history and candle tables have named, keyboard-focusable scroll
regions. Long mints wrap or truncate with a labeled copy control rather than
force page width. Native chart drawing has a readable candle table alternative.
No decorative entrance animations are added.

The standalone community route leads with project affiliations or research
briefs, not disabled creation forms. Deliberate Add project / Create brief
actions open focused dialogs and restore focus on close. Underlined section
buttons name their controlled content region. Compact terminal utilities reuse
the same components, with a single-column support layout and no duplicate page
header. Empty directories explain how to start without invented project counts
or activity. Public roles stay explicitly self-declared and research rewards
stay labeled unfunded sponsor pledges, not escrow. Protected receipts sort
first and remain reachable from every section; the payment dialog stays at
the same root, independently of the new metadata-creation dialogs.

Independent mechanical source pass: the referenced Impeccable detector script
is absent in this checkout. Manual inspection addressed min-width on all grid
tracks, touch targets, overflow, nested swap-panel padding, table regions,
consistent 4-unit spacing, and reduced-motion behavior. The final release also
requires rendered browser verification below.

Container queries use unnamed nearest-container rules intentionally. The native
bundle compiler rewrites named query identifiers but not their shorthand
declarations; the first browser run exposed that mismatch. The corrected rules
are verified in both bare fixtures and the real 192px forum-rail frame at
1024/1440px, with small/zoom-equivalent layouts and chart hide/show resizing.

## Verification ownership

Feature worker runs lint and TypeScript only. Root runs the integrated tests:

```sh
bun run test -- components/trading/terminal-format.test.ts
bun run test:forum:render -- tests/e2e/terminal.spec.ts
```

The browser fixtures use invented public data, fake authentication boundaries
and intercepted requests. They cannot reach production, request wallet approval
or move funds. They cover small/large viewports, exact selected-mint chart
binding, FDV/cap separation, preserved alert thresholds, protected operation
display and the native-host payment boundary.
