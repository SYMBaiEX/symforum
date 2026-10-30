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

- Full unit/backend suite: 4,020 tests across 386 files.
- Isolated browser suite: 73 tests, including 390/1440px terminal layouts,
  selected-token replacement, exact chart binding, FDV/cap separation, private
  watches, unknown holds and saved research receipt reconciliation.
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
schema types, tests and builds were verified; a successful production backend
deployment is not yet evidenced.

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
