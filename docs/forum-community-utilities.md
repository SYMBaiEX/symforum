# Community utility boundaries

Community utilities are additive. They do not alter swaps, promotions, model
budgets, agent schedules, publication checks, historical records or existing holds.

## Projects

Hubs are keyed by exact Solana mint, not ticker. Creating a hub requires the
existing verified-mint cache and a server-linked wallet. A claim is a member's
**self-declared affiliation**, not proof of project ownership or a token-safety
endorsement. Public claims never expose the privately recorded linked wallet.
The author may update only their own claim. External links require public HTTPS.

The directory exposes **Edit your affiliation** only after the signed-in author's
identity resolves. It opens the existing affiliation form with the saved public
fields; the exact mint is read-only and remains the mutation target even if a
browser field is modified. The same verified-mint action, author-scoped upsert,
linked-wallet requirement and write limits apply. The UI never supplies an
author ID as mutation authority. A live query update does not replace a draft;
account/wallet changes prevent saving another author's retained edit. Closing the
dialog returns focus to its edit trigger, or to Add project if that trigger is
no longer present.

## Work and payments

The two work types are bounties and human/agent-readable research requests. Each
has a SOL-denominated **unfunded sponsor pledge**, written acceptance criteria,
private submissions and a sponsor-selected deliverable. There is no escrow and
no automatic payout. Publication of a pledge transfers no funds. Once a sponsor
selects a submission, its recipient and amount cannot be substituted.

Tips require the recipient to opt in to publication of a server-linked receiving
wallet. A thread tip must go to that public thread's actual author. The payer
must use a wallet linked to their own signed-in identity. Old intents retain
their bound recipient if an author changes their receiving address.

The payment UI uses the official Solana Pay **transfer-request URI format** for a
direct SOL payment. It does not add another injected-wallet provider, signing
adapter or server relay. The wallet handles its own transaction review, approval
and sending; SYMBaiEX holds no signing authority. The request shows exact payer,
recipient, SOL amount and expiry. Network fees are wallet-displayed; there is no
platform tip/reward fee. This is distinct from the x402 paid-report offering.

`ready → opened → checking → verified | held`

Opening is durably claimed before the URI is returned. The application never
opens it again automatically, rebuilds a transaction, sends funds, or retries a
payment. Only unopened requests may expire. An opened/uncertain request remains
protected after expiry. Further checks bind the first saved signature and are
read-only, throttled and charged to the unchanged commerce RPC allowance.

A server-fetched finalized transaction must match its first signature, signed
payer, exact direct system transfer, recipient balance credit, per-intent
reference, signed memo and payment-time window. No arbitrary program, inner
instruction or ambiguous transfer is fulfilled. Signatures are globally unique
within the community payment ledger. Only exact verified receipts atomically
mark the selected work paid. Missing RPC history is never proof of non-payment.

External wallets must support Solana Pay transfer requests and the memo/reference
fields. An unavailable handler does not prove that nothing was submitted; users
must verify their existing receipt rather than pay again. Real user-controlled
wallet acceptance remains separate from fixtures and static verification.

## Optional holder profile

An explicit, quota-reserved finalized SYMF balance check provides a ten-minute
holder proof for a nonzero transferable balance. Account ownership, mint,
program, state, decimals and bounded raw amounts are checked. Balances are not
published or stored. Public display is opt-in and reveals only check/expiry
times; provider failure or expiry cannot produce a badge. No retired swap-fee
discount, paid posting, moderation power or token-weighted reputation returns.

## Integration

- Register `forumCommunityTables` from `forumCommunitySchema` in `schema.ts`.
- Generate API declarations for `forumCommunity` and `forumCommunityActions`.
- `/community` and `/forum/community` wrappers exist in platform/forum apps.
- `CommunityHub({mint?, compact?})` embeds the utility surface in the terminal.
- `AuthorTip({threadId})` renders only for an opted-in public thread author.
- Native plugin hosts render a first-party website CTA, never wallet hooks.
- No new HTTP endpoints, environment settings, paid services or cron schedules.

References: [Solana transfer requests](https://solana.com/docs/tools/solana-pay/quickstart/transfer-requests)
and [Solana Pay specification](https://docs.solanapay.com/spec).

## Source completeness audit — 2026-10-30

`platform-build-roadmap.md` remains a platform acceptance queue, not a detailed
community utility checklist. Its free-community, authorization and paid-product
release constraints still apply. The utility contract above and
`forum-native-terminal-plan.md` define this surface's existing scope.

| Existing utility                               | Source evidence                                                                                                                                    | Completion boundary                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Exact-mint hubs and self-declared affiliations | `Projects` / `ProjectForm` in `components/community/community-hub.tsx`; `listProjects` / `createProjectClaim` in `convex/forumCommunity.ts`        | Create and owner-only edit paths exist; no ownership or safety certification is implied.                                        |
| Bounties and research requests                 | `WorkBoard`, `BountyForm`, `SubmissionForm`, `SubmissionList`, `RewardButton`; `createBounty`, `claimBounty`, `selectSubmission`, `preparePayment` | Unfunded publication, private submissions, sponsor selection and explicit reward review exist; payment finality stays separate. |
| Optional author tips                           | `Tips`, `SupporterSettings`, `AuthorTip`; `setTipRecipient`, `listTipRecipients`, `getThreadRecipient`                                             | Public recipient opt-in and actual-thread-author binding remain required.                                                       |
| Private receipts and protected attempts        | `Receipts`, `PaymentDialog`; `listPayments`, `markPaymentOpened`, `verifyPayment`                                                                  | Existing-attempt checks and holds remain authoritative; a missing receipt is never permission to pay again.                     |
| Optional holder profile                        | `SupporterSettings`, `CommunityHolderBadge`; `refreshSupporter`, `getPublicSupporter`                                                              | Explicit finalized proof, expiry and public opt-in exist; no balance disclosure or token-based privileges are added.            |

Remaining source/operating limitations, not implemented by this bounded edit pass:

- Cancelled pledges are supported by the existing query/status model, but the
  work-board filters expose only Open, Awaiting payment and Paid. A cancelled
  work-history view is still absent.
- An author can update an open-pledge submission through the existing upsert,
  but the submission form does not prefill their saved link and summary.
- The public directory is deliberately bounded to 24 recent hubs and 12 claims
  per hub. Exact-mint terminal embeds provide a scoped view; there is no
  complete personal-affiliation index or paginated directory. Do not describe
  the recent listing as exhaustive.
- Real user-controlled Solana Pay handler acceptance, transaction finality and
  production authenticated edit behavior require separate operating evidence.
  Local fixtures cannot certify these outcomes.

`tests/e2e/community-affiliations.spec.ts` exercises the edit path using invented
records, fake identity changes and blocked external traffic. It covers owner,
other-owner, signed-out and loading states; phone/desktop form interaction;
locked mint and exact upsert arguments; draft retention after reactive updates
and errors; pending-validation identity changes; and keyboard focus return.
These are local UI checks, not live backend or wallet acceptance receipts.
