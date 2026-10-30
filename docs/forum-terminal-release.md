# Forum terminal release handoff

## Complete stack

The shared contracts, bounded public market cache, existing-slot sampled
discovery, readable archive/agent focus, community utilities, x402 research and
native terminal UI are integrated on `sym/forum-terminal-release`.

The PR chain is #228 → #229 → #230 → #231 → #232 → #233 → #234 → the release
wiring PR. Preserve merge lineage when merging bottom-up. Do not squash a parent
and accidentally include its whole history again in a child. No GitHub Actions
were used as a gate; checks are local.

New first-party routes are `/trade` and `/community`, mirrored under `/forum`.
The terminal uses the existing linked-wallet identity and `TokenSwap`, not a
second swap signer or router. Its optional utility panels expose project hubs,
sponsor research/bounties, tips, holder profiles and paid report exports.

## Verification

- Full unit/backend suite, including archive interface regressions: 4,077 tests
  across 392 files.
- Isolated browser suite: 96 tests, including 390/1440px terminal layouts,
  selected-token replacement, exact chart binding, FDV/cap separation, private
  watches, unknown holds and saved research receipt reconciliation.
  The presentation redesign adds content-first project/research views, empty
  states, creation-dialog focus, section-region relationships, protected
  community receipts, mobile Trade access, search/icon geometry and light/dark
  coverage. These tests block external traffic and use invented records only.
  The connected-desk pass additionally checks sortable true-cap/null metrics,
  safe sources, initial-mint links, chart mismatch rejection, mounted chart/order
  state across tabs, 640px zoom-equivalent reflow and the real forum frame.
- All five local production builds: platform, forum, blog, news, newsletter.
- App/Convex types, lint and repeat native artifact checks. Lint retains three
  pre-existing warnings; no schedules were changed to silence them.
- Dependency audits: no reported vulnerabilities in the root, Eliza worker or
  gateway lockfiles. Secret-scanner negative controls passed.

The browser fixtures use invented records and intercepted requests. No real
wallet signature, payment, publication, model replay or hold release was used.
The real Phantom swap and Solana Pay/x402 settlement still require separate
user-controlled acceptance; fixtures do not prove mainnet payment completion.

Read-only development code generation was attempted against
`dev:dependable-warbler-666`. Its existing auth configuration lacks
`NEXT_PUBLIC_INSTALLATION_CONFIG`, so deployment-state validation stopped there.
The development environment was not reconfigured. Local module declarations,
schema types, tests and builds were verified. Production had not been deployed
at that local-validation stage; the dated rollout receipts below supersede
that status without changing the development environment.

## Preserved operating limits

- Current swap fee remains 0.50%, with no holder discount reintroduced.
- Existing promotion price/burn/inventory and historical receipts are unchanged.
- Existing model budgets, schedules, agent identities, correction/review gates,
  failure circuits and every uncertain-outcome hold remain unchanged.
- Discovery rotates documented market-cap filters inside the existing hourly
  request slot. It does not add provider requests or model calls. Coverage is
  sampled, not a platform-wide top-token claim.
- Terminal chart/wallet/risk reads share a 100-unit/day sub-budget within the
  unchanged 1,000-unit/day commerce allowance. Global cache leases and negative
  caching coalesce traffic; exhaustion returns an honest unavailable/stale state.
- Chart/source metrics are not executable quotes. Exact mint metadata and fresh
  simulated routes remain required for wallet execution.

## Production authorization and activation

No production deployment, category migration, backfill or paid activation is
part of the local verification above. The exact target is
`prod:strong-bee-384`; fresh target-specific approval is required before writes.

1. Deploy additive schema/functions before exposing the new frontend routes.
   Preserve every existing environment setting. The new promotion index is
   additive; inspect table size before deciding whether it needs staging.
2. Preview `forum.previewForumTaxonomy({now})` with an authenticated board
   administrator. Review exact IDs/fingerprint/blockers, then explicitly apply
   only that manifest. Projects, Research and general News/Hacker News become
   readable archives; AI, Gaming, Web3, Hacking, Music and General support stay
   active. Existing slugs, content and private ancestry are preserved.
3. Optionally page the bounded public sample/verified-promotion projections via
   `forumTerminalData.backfillTrackedMarkets` and
   `forumTerminalTransparency.backfillPromotionReceipts`. These read existing
   records only, never fetch/model/publish/pay, and do not change source holds.
4. Merge the locally tested stack bottom-up with preserved lineage, then verify
   actual frontend aliases and public pages. A merge is not a deployment receipt.
5. Keep research charging disabled until the exact treasury USDC account,
   facilitator identity/rate and actual initial free-credit allowance are
   verified. Do not create a paid plan, top up or invent a credit balance.

## Verified production rollout: October 30, 2026

- PRs #228–#236 were merged with preserved lineage and existing protections.
  The additive backend deployed successfully to `strong-bee-384`; no indexes
  were deleted and no environment settings were changed.
- The first complete website release was commit `35e3a887`, followed by the
  guarded admin control at `ffd8eea1`. Vercel deployment
  `dpl_Ad4refUG72oEbYcEThRMDVN6TLVp` reached READY at 17:02:13 UTC with all
  five existing public app domains assigned. Local verification for that tree
  passed 4,028 tests, 73 browser checks and all five production builds.
- An authenticated administrator previewed and reviewed all 18 structural
  changes, then applied the guarded manifest once at 17:15:11 UTC. Moderation
  audit receipt `pn72a5dj5fk3ax2tkc30tmvf0n8h9qcf` records the inverse manifest.
  All 18 resulting category rows matched the receipt. Representative original
  Projects, Research and News thread identities/URLs were unchanged and returned
  HTTP 200; `/crypto` remained stable and displayed Web3. A rendered archived
  thread showed its read-only notice with no reply form.
- The 35 enabled Luna agents, their stored publication targets and the actual
  $2/day model setting remained unchanged. The 48 pre-existing unknown runtime
  operation rows matched their pre-release digest byte-for-byte. No calls were
  replayed, holds released, wallet transactions signed or payments sent.
- Research charging remained disabled (`setup_required`, no control row). No
  provider credit allowance was invented, paid account enabled or backfill run.
- Discovery was correctly empty because all stored scout samples were stale.
  Existing uncertain operations `bags:2026-10-23T12` and
  `pumpfun:2026-10-24T02` still fence their respective lanes. This rollout does
  not authorize clearing those holds or generating replacement calls. Direct
  checked SYMF chart/market reads were verified separately under the existing
  shared data allowance; they are not proof of live scout coverage.

The archive interface follow-up removes Reply/new-promotion invitations from
archived threads and archived boards from the primary navigation/post picker.
Existing payment receipt checks, token swaps and author tips remain available;
the backend's independent archive admission checks are unchanged.

## Connected desk presentation follow-up

The user's Birdeye reference informs composition, not copied branding or data:
the terminal uses the full available forum work area, a wide chart, persistent
order column and dense sampled-market table. The old discovery-rail component
is removed. Initial-mint links now preserve exact identity and malformed links
fail closed before chart/wallet mounting. Existing metadata remains display-only
until the original linked-wallet verification path succeeds.

The first browser pass caught named-container identifiers being rewritten
inconsistently by the native CSS compiler. Unnamed nearest-container rules fix
mobile stacking without weakening the responsive assertions. Separately, an
existing 200-wallet test froze only Date.now(), so its authentication sessions
expired against the advancing Date constructor. Its test clock now freezes both;
the same 1-admitted/199-rejected assertions and all production code are unchanged.

No new Birdeye subscription, provider endpoint, backend function or environment
setting is introduced. The same data caps, budgets, original schedules and
uncertain holds apply. No wallet signing or mainnet settlement is part of this
presentation verification.

The integrated presentation tree passed 4,077 tests across 392 files, all 96
browser checks, application and Convex type checks, lint (no errors; three
existing warnings), secret-scanner negative controls and all five local
production builds. Browser coverage includes the actual forum-width rules,
mobile/dark layouts, exact mint intent, accessible tabs, numeric table sorting
and preservation of mounted order/receipt state. These isolated fixtures do not
prove a real wallet payment or resumed scout coverage.

## Payment capability boundaries

Research is a separate explicit $0.10 USDC product. Existing free APIs stay free.
The frozen report exists before approval; provider settlement is claimed once,
never redirected/retried, and fulfilled only after exact finalized proof. Saved
known-signature receipts have a read-only verification path after reload. Owner
holds are pinned ahead of recent receipts and cannot be bypassed by switching
linked wallets. Unknown receipts without proof stay protected.

Initial x402 spending requires a human owner's authenticated linked wallet.
Existing evidence-only agent grants do not imply wallet-spending delegation.
The machine-readable catalog and V2 HTTP transport document that boundary.

Tips/rewards use explicit Solana Pay-compatible external wallets/link handlers;
the connected browser extension alone does not prove URI-handler support. The
UI asks users to confirm compatibility before claiming a handoff. Sponsor
pledges are not escrow, affiliations are self-declared, holder badges are dated
opt-in proofs, and no treasury key or autonomous payout is introduced.
