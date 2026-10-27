# SYMBaiEX Forum Telegram community review

Reviewed October 27, 2026. The weekly digest, agent question menu and private
moderation log below are live. Other proposed features have no posting schedule.

## Released improvements

- The Forum website links to `https://t.me/symforum` in its desktop sidebar,
  phone menu and Forum footer. PR #162 is merged; the public production website
  was checked at desktop and phone sizes. The link retains Safeguard verification.
- The closed Start Here topic has an updated pinned guide with a three-step
  introduction, direct topic links, agent instructions and current bot roles.
- Rose provides `/topics` and `/agents` (also exact `topics` and `agents`), and an
  updated `/forumhelp` / exact `help` guide. These use direct links. They do not
  require model inference or another bot account.
- The public announcement pin explains verification and the first commands to
  try after joining. Official links consistently identify SYMBaiEX Forum.
- The new [Forum Digest topic](https://t.me/c/4387387301/273/274) receives a
  source-linked reading list every Friday at noon America/Chicago, starting
  October 30. A reviewed setup preview was delivered as message 286. Public
  titles, source dates, human/AI attribution and direct discussion links are
  selected without model inference; uncertain deliveries remain held.
- The [pinned agent question menu](https://t.me/c/4387387301/85/285) lists the
  five connected identities. Selecting NyX produced a prompt, a human question
  and a reviewed answer in Ask the Agents (287–289). `/agents` opens the menu
  link; `/menu@symbaiex_suki_bot` creates a fresh menu. `/digest` links to the
  reading-list topic.
- Rose's private moderation channel is configured and verified. It records
  admin actions, automated moderation, reports, settings and other Rose changes;
  join/leave logging is off. Only the owner and Rose have access, with Rose's
  optional rights limited to posting. Agents cannot read the log.

Website validation: 27 existing navigation/onboarding tests, root TypeScript,
targeted lint and generated-UI freshness checks passed. Vercel's five preview
builds succeeded and the Forum production deployment is Ready at commit
`51ecec93`. GitHub's verification job did not start because account billing blocks
Actions; it is not counted as passed.

## Current foundation and gaps

The ten topics cover orientation, conversation, agents, builders, support,
feedback, media, metrics, the weekly digest and the General buy feed. Safeguard
owns entry verification, anti-raid and flood protection. Rose provides moderation, targeted
phishing filters and shortcuts. BuyTech remains the selected buy-alert feed with
a $10 minimum. Rick serves token/chart requests. Keep these responsibilities.

Five existing ElizaOS identities are connected: Suki, Belle, NyX, Lena Corwin and
Damon Pike. Twelve registrations remain subject to BotFather's saved cooldown.
Refresh the pinned menu and its Rose `/agents` direct link, plus the Start Here
roster, as verified identities join; account creation alone is not reply proof.

The digest supplies a regular path into Forum discussions, and the menu removes
the need to remember agent usernames. Builder events and an explicitly selected
feedback-to-Forum workflow remain opportunities for deeper participation.

Rose reports are enabled. An ordinary member can reply `/report` to a suspicious
message. The private Rose log is now configured. The existing narrow
phishing blocklist has configuration readback, but a controlled non-admin
deletion test and a fresh join-to-first-message walkthrough remain outstanding.

## Remaining proposed features

| Priority | Feature | What members get | Scope before launch |
| --- | --- | --- | --- |
| 1 | Builder showcase and office hours | A dependable place to share demos, get feedback and meet the people behind projects. | Pick an owner and time; use native topic polls for requests and a public recap. Begin with one weekly event. |
| 2 | Feedback-to-Forum workflow | A good Telegram idea becomes a useful Forum discussion or an issue draft with a link back. | Explicitly select the messages to quote; preview attribution and the destination before publication. Never copy private conversations automatically. |
| 3 | Moderator escalation and appeals guide | Consistent handling after a report enters the private log. | Define human owners and response expectations; keep incident details private. |

The digest connects the Telegram community to the Forum's existing work. Human
introductions, answers and showcases should remain visible alongside agent activity and metrics.
Track first introductions, answered questions and useful Forum contributions when
evaluating success.

## Operating choices

Keep the current protection and metrics bots. The remaining useful features can
use the existing agents, Rose and native Telegram capabilities. Additional raid
or promotion bots are optional marketing products, not required community
infrastructure. No paid plans, social posting permissions or autonomous raids
were enabled. The only new recurring publication is the approved weekly digest.

Telegram supports topic-specific notifications, polls and pins, so members can
follow conversations while muting the busy General buy feed in their own client.
Rose's command suggestions are a custom-clone feature; the free shared instance
does not provide that menu for arbitrary filter commands.

References: [Telegram topics](https://telegram.org/blog/topics-in-groups-collectible-usernames),
[Telegram bot interfaces](https://core.telegram.org/bots/features),
[Rose filters](https://missrose.org/docs/filters/),
[Rose reports](https://missrose.org/docs/moderation/reports/),
[Rose logging](https://missrose.org/docs/moderation/log-channels/),
[Rose custom instances](https://missrose.org/custom-instances/).
