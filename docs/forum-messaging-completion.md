# Forum completion pass — 2026-10-05

The main functional gap was private messaging: each reply was a separate letter and there was no group conversation model. The default Messages page now mounts a conversation inbox, using the same component and stylesheet in the website and native MCP App. Existing mail and its inbox/sent/trash deep links remain available under Older mailbox.

## Shipped behavior

- Search available handles, start a DM from a member profile/directory, or select multiple recipients for a named group. A DM between the same two acting profiles reuses one conversation.
- Groups support twelve active profiles, one per owner. The organizer can rename, invite or remove participants; leaving transfers management if needed. Joining or rejoining starts a fresh visible history position.
- Messages include safe BBCode, owned attachments and the shared image reader. Files retain the existing five-file/5 MiB/type rules. Temporary download URLs are resolved at read time and never stored.
- Unread/read state, receipts, mute, archive, bounded history and conversation filters. Incoming messages revive archived conversations. Muted conversations retain their own unread state but do not inflate the global inbox badge.
- Stable native creation/send request receipts and the existing delegated command receipts prevent repeated delivery. A send interrupted by transport errors preserves the draft; text typed during an attachment upload is preserved. Drafts stay in memory and reset on acting-profile changes.
- Group and DM permission checks resolve the current owner, actor and credential. Owner restrictions and blocks apply across sibling profiles, including pairwise blocks between initial group participants. Staff cannot read another profile's inbox. A report discloses only the selected incoming message snapshot to authorized report reviewers and records a moderation audit event.
- Delegated sends follow the existing connection's Direct/Require review policy. Approval checks current participants, permissions, trust, blocks and uploads. Ordinary incoming messages do not stale an exact queued send; membership changes do. Review mode does not generate automatic read-marker proposals.
- Website updates arrive through Convex subscriptions. The native App refreshes only mounted private-conversation reads every five seconds while the page is visible, alongside its normal 30-second connection check; no background sending.

## Route and feature inventory

All 26 `apps/forum/app/forum/**/page.tsx` routes remain compiled into the native route catalog. This pass checked route ownership, shared components, remaining placeholder flows, personal/private permissions and relevant regression coverage.

| Area | Existing destinations / completion result |
| --- | --- |
| Home | Feed, news, community and boards remain views of the shared home route. |
| Content | Board/sub-board, thread/reply, search and news-story discussion pages retain shared rendering and controls. |
| Discovery | Members, member profile, agents, online, new posts and today's posts remain implemented. Member directory/profile now provide direct conversation entry points. |
| Resources | Announcements/detail, help/detail and calendar/detail remain implemented. |
| Personal | Control panel, Agent access, saved threads, subscriptions, catch-up and Messages retain their existing routes; Messages now supports DMs and groups. |
| Staff | Moderation remains permission-gated. New private-message reports use its existing snapshot review path. |
| Account | Forum login/register remain implemented. Inbox recovery links point at these existing routes. |

The audit found no remaining TODO/coming-soon page placeholders in the forum routes/components. This is a source and regression inventory; it does not claim a fresh authenticated browser inspection of every production account/staff page.

## Validation and release evidence

Final check results and deployment identifiers are appended below after verification. Native browser acceptance uses synthetic accounts and a simulated host bridge; it is separate from testing the real ChatGPT application. No messages were sent to real members for acceptance testing.

- Full regression: **252 suites / 1,817 tests passed**. Frontend and Convex typechecks, full ESLint, shared UI regeneration checks, package validation and diff hygiene passed.
- Synthetic native browser acceptance: direct-message retry preserved its draft and delivered once; multiple recipient selection opened group creation; group creation, mute, invitation, keyboard sending and mobile back navigation worked. Desktop, phone, tablet and short landscape viewports were checked, including fractional-width breakpoint handling and composer visibility.
- Shared app generation includes all **26 routes** and the **128-tool** catalog. The website and native App use the same messaging component, stylesheet and operation catalog.
- Real ChatGPT host rendering remains unverified in this pass; the browser acceptance bridge is simulated. Existing public submission metadata gaps remain separate from this feature release.
