# Branch consolidation audit

Audited against `origin/main` at `b419528dda89b7e5426a999b0fb891e6c7f73a7e`.
This is a source-preservation audit, not authorization to replay operations,
change production settings, or bypass review and worktree protections.

## Current worktrees

| Branch | Finding | Disposition |
| --- | --- | --- |
| `main` | Local tip `c2ecc4c2` is an older news/newsletter redesign. Its entire dirty working tree is byte-identical to saved commit `b92f65de`. | Preserve the original snapshot; retain current designs and Better Auth rather than applying the old tree wholesale. Recover missing broadcast source separately. |
| `sym/editorial-page-consistency` | Tip `50fa39cf` is an ancestor of main. | Already merged; eligible for retirement after the owning worktree can be archived. |
| `sym/jupiter-managed-swaps` | Tip `b419528d` is current main, merged in PR #221. | Already merged; current chat continues on the focused broadcast-preservation branch. |
| `sym/fix-forum-plugin-black-screen` | Its complete tip tree equals main's squash commit `c702cbeb` (PR #132). The combined patch also matches exactly. | Already integrated; preserve newer protocol/CSP changes. |
| `sym/forum-start-here` | Tip `4ec45282` is an ancestor of main. | Already merged; eligible for supported worktree retirement. |
| `sym/fix-web-vitals-soft-nav` | Commit `7cf04bb1` is patch-equivalent to main's `0993008e` (PR #145). | Already integrated. |
| `sym/news-newsletter-editorial-routes` | Commit `b8a39fce` is patch-equivalent to main's redesign (PR #122). | Already integrated; do not roll back later editorial changes. |
| `sym/ora-webmcp-recognition-inline` | Commit `d6c4b50d` is patch-equivalent to `9e2803e8` (PR #148). | Already integrated. |
| `sym/convex-generated-bindings` | Commit `a5df27e6` is patch-equivalent to a main commit. | Already integrated; never replace newer generated bindings with this old version. |
| `sym/research-optimization-batch` | All seven commits have patch-equivalent commits in main. Both uncommitted generated-file blobs already occur in main's history. | Preserve its recovery snapshot; no old backend files need to be reapplied. |
| `sym/x-telegram-topic-relay` | Tip `1c3fd98e` is an ancestor of main. | Already merged; preserve running connectors and delivery holds. |
| `sym/solana-breaking-desk` | One genuinely new commit `d471d285`, PR #222. | Keep separate for independent review. Do not delete or enable the new production flag during cleanup. |
| `sym/unified-human-agent-auth` | Older whole-platform consolidation and WorkOS-era auth tree; live main has the five-app split plus the subsequently verified Better Auth migration. Its broadcast directories were never added to main. | Recover the missing broadcast surface only; retain newer auth, routing, dependencies, generated files and safety gates. Keep the old snapshot available. |
| `codex/research-quality-wave` | Both commits are patch-equivalent to commits in main. | Already integrated; preserve current quality gates. |

## Detached and uncommitted work

- `batch-review`: all 131 changed file blobs already exist in main's history.
  It is not an additional feature branch. A local recovery commit preserves its
  exact tracked and untracked tree.
- `forum-tool-review`: clean detached tip `bd548618` is an ancestor of main.
- The legacy Claude checkout contains an incomplete framework migration, not a
  deployable feature: its new `proxy.ts` is a test module importing a missing
  middleware entry. It also adds obsolete `instant = false` declarations to old
  routes. Preserve this scratch snapshot rather than shipping invalid code over
  the modern routing/auth implementation.

Four exact dirty-tree recovery commits are kept under local
`refs/cleanup/20261030-integration/*`. These refs are not pushed. The operator's
local cleanup manifest records full commit IDs, paths and status/diff hashes.
Ignored credentials, local app state, recordings and music masters are not
included in source-control publication.

## Missing source recovered

The focused preservation change adds only these existing directories:

- `apps/forum/public/broadcast`: agent-only reading desk, artwork, live
  metadata subscription, token footer and existing transitions.
- `scripts/broadcast`: local OBS operations, browser capture-deny policies,
  radio player/playlist and isolated tests. Operational scripts are **not run**
  as part of merging or testing this change.
- `workers/broadcast`: the existing static-asset/cache worker source and its
  configuration, without deploying it or activating a new service.

Node-runner broadcast tests have explicit package commands and are excluded
from Vitest. The browser regression uses local fixtures, denies remote HTTP and
WebSocket connections, checks bundled assets, and exercises the actual 45-second
reading flow, activity metadata, layouts and market-cap expiry rules.

No old auth code, environment values, generated backend types, source-history
holds, production flags, model budgets, agent schedules or publishing gates are
overwritten by this preservation change.

## Retirement constraints

GitHub currently requires one independent last-push approval, including for
administrators. No branch protection is weakened for consolidation. The app
also refused archive of `batch-review` because it is protected by a pinned task
or workspace; preserve that checkout and use the supported archive lifecycle
once unpinned. Do not force-remove app-managed worktrees or claim that a
patch-equivalent branch is ancestry-merged.
