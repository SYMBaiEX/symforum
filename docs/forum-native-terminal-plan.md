# Native forum terminal release contract

This is the complete requested pass, not an isolated demo. Preserve existing
accounts, posts, URLs, paid-promotion receipts, schedules, budgets and uncertain
outcomes. Do not sign/send mainnet transactions during automated verification.

## Product scope

- Five clear editorial pillars: AI, Gaming, Web3, Hacking and Music. General,
  introductions and support remain community areas. Archive Projects, Research
  and general News/Hacker News read-only; preserve every ID, slug and old URL.
- Web3 uses the existing crypto slugs, including crypto-pumpfun/crypto-bags.
- One native terminal: market discovery, generic mint chart, existing TokenSwap,
  source-backed risk facts, forum discussions, private wallet balances/history,
  watchlists/alerts, project profiles and treasury/burn transparency.
- Market-cap bands are half-open actual market capitalization, never FDV. Unknown
  is its own class. Discovery remains truthfully sampled within current quotas.
- Add source/cap rotation inside existing hourly scout fetches, not more fetches
  or model calls. Keep exact-mint deduplication and follow-up thread behavior.
- Include optional supporter proofs/perks, author tips and sponsor-approved bounty
  rewards. No pay-to-post, pay-to-moderate, token-weighted reputation or custody.
- A separate opt-in Solana x402 product: a sourced, shareable token-research brief,
  initially $0.10 USDC (100000 base units), using the approved treasury. Keep all
  existing free-beta APIs free. Do not advertise SYMF settlement until supported.
- Every fee/payment is explicit. No autonomous treasury keys, purchases, payouts,
  recurring charges, top-ups or fallback payments. A bounty pledge is not escrow;
  label it accurately until an actual verified payout. Paid fulfillment and
  uncertain settlement each have durable, non-replayable receipts.

## Worktree ownership

Root owns central package/generated API/HTTP/cron integration, shared types,
navigation integration, stacked PR review/merge and final tests. Feature workers
write regression tests and run lint/typechecks only; no worker deploys or tests
production money. Each works in its dedicated worktree and preserves others.

| Lane | Backend/UI ownership |
| --- | --- |
| Taxonomy | category archive field + forum authorization/migration; Suki/Belle/NyX/roster source/target focus |
| Markets | terminal read models/cache; existing scout sample persistence/cap rotation; wallet, token risk, watchlists and public transparency |
| UI | new components/trading and route wrappers; generic chart; complete loading/empty/stale/offline/held states |
| x402 | official SDK, dedicated paid route/catalog, durable settlement and report delivery; UI payment client adapter |
| Community | tips/bounties/project claims/supporter proofs, their schema modules and explicit payment lifecycle |

Schema fields/modules must be additive. Never widen archived private-board
visibility. Archival must deny writes even for moderator bypass paths while
retaining permitted historical reads. Do not rewrite old editorial posts.

## Shared interfaces

`lib/forum-market-cap.ts` owns band IDs/labels/classification.
`lib/forum-terminal-model.ts` owns public market and owner-only wallet read types.

- `forumTerminal.listMarket({band?, platform?, now, limit?})`: bounded sampled list,
  limit <=60, public allowlist only. Do not expose raw scout runs/private drafts.
- `forumTerminal.getMarket({mint, now})`: exact public token snapshot or null.
- `forumTerminal.getWalletReadState({wallet, selectedMint?})`: authenticated linked
  owner only; restrict token reads and reserve existing commerce network quota.
- New market/chart endpoints must bind selected mint, verified pool and quote,
  use bounded cache leases, and return nullable/stale states on source failure.
- `TokenSwap({outputToken})` remains the only swap execution component. A public
  discovery row is display-only until existing resolveMint verifies its mint.
- Research payment resource identity binds product/version, mint, body hash,
  quote amount, network, recipient, owner and idempotency key before settlement.
- x402 settlement is claimed once. Unknown response stays held; no replay,
  auto-refund or fulfillment retry across an uncertain expensive operation.

## Acceptance before release

Root runs all unit/backend tests, complete isolated wallet/forum browser tests,
new terminal/mobile/archive/x402 cases, security/dependency scans, app+Convex types,
all five builds and repeat native artifact checks. Verify old forum links,
archive read/write behavior, exact payment binding and no duplicate fulfillment.
New controls must have real data/actions and accessible error/empty states.

Then root reviews and merges the tested stacked PRs. Production deployment and
the exact board/agent migration need fresh explicit target-specific approval.
Real wallet swap, promotion and x402 settlement are separate user-controlled
acceptance evidence; test fixtures or HTTP200 do not prove them.
