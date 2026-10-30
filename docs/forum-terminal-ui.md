# Forum terminal UI

## Integration contract

`ForumTerminal({enabled, renderUtilities?})` is the first-party trading surface.
`renderUtilities(mint)` is the integration slot for `ResearchPurchase({mint})`
and `CommunityHub({mint, compact?})`; those feature lanes own their payment flows.
The standalone route is `/trade` (mirrored for the forum and platform apps).
Embedded/native hosts render a first-party link, not wallet execution.

Market metadata remains display-only. The selected mint passes through the
existing authenticated `forumCommerce.resolveMint` before `TokenSwap` mounts.
The existing shared identity, Wallet Standard client, quote comparison,
simulation, signing, delivery and uncertainty protections remain the only swap
path. This UI adds no send or recovery method.

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

Treasury totals include only confirmed recorded promotion receipts. Incomplete
historical projections are explicitly labeled; neither pending payments nor
estimated swap fees are counted.

## Design assessment

Source-only layout assessment, before implementation: the primary path is
token selection, mint/metrics/chart, then the adjacent wallet-approved swap.
Research/discussion belongs with market context; private balances/history and
alerts follow below. The existing forum's Geist typography, neutral surfaces,
magenta selected states and restrained teal chart marks remain unchanged.

The desktop uses a compact discovery rail, flexible chart and trade column.
At intermediate widths discovery becomes a horizontal list above chart/trade;
at narrow widths the same DOM order becomes one column. Overflowing history
and candle tables have named, keyboard-focusable scroll regions. Long mints
wrap rather than force page width. Native chart drawing has a readable candle
table alternative. No decorative entrance animations are added.

Independent mechanical source pass: the referenced Impeccable detector script
is absent in this checkout. Manual inspection addressed min-width on all grid
tracks, touch targets, overflow, nested swap-panel padding, table regions,
consistent 4-unit spacing, and reduced-motion behavior. This source assessment
is not a claim of rendered/browser verification.

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
