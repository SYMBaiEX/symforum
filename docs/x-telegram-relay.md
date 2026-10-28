# @symforum → Telegram

This deterministic relay sends new authored @symforum posts (including replies
and quotes, excluding reposts and flagged-sensitive posts) to one owner-selected
topic in the existing SYMBaiEX community. It sends plain text and a canonical X
link, not copied media attachments. Long text is shortened with its source link.

It reuses NyX's existing authenticated official-account timeline reader, 15-minute
source cadence, pagination and 360/day shared X-read ceiling. It does not read
another X account, add polling, invoke a model, change agent schedules/budgets,
or grant bot administration. A reader outage/hold or exhausted quota can delay
delivery. Up to five source posts are handled per existing timeline page; large
bursts require subsequent ordinary pages.

## Activation

1. Confirm the human owner created `X · @symforum` in the existing community and
   Suki can send to it. The operator helper `scripts/telegram-x-topic.ts` can
   inspect permissions, adopt the exact owner-provided topic link and send the
   separately authorized one-shot announcement. Credentials/state stay in
   owner-only local files, never arguments containing secret values or logs.
2. Deploy additive schema/functions to the explicitly approved target, preserving
   any already-deployed concurrent changes. All relay functions are internal.
3. With fresh production authorization, call `xTelegramRelayData:initialize`
   with the verified topic ID. Server time becomes the immutable forward cutoff.
   Initialization refuses an existing configuration and cannot rewind history.
4. Inspect the singleton config and indexed delivery metadata. Verify a future
   ordinary post against its actual Telegram receipt. Never create/replay a
   public X post just to test the relay without separate authorization.

## Delivery safety

The source user ID is fixed, not a mutable display handle. Enqueue occurs inside
the active X-reader lease transaction; manual source checks cannot backfill it.
Permanent post-ID records deduplicate pages, retries and overlapping readers.
An atomic, nonrenewable claim precedes the Telegram request. Only a receipt with
the expected community, topic and positive message ID is marked sent. Ambiguous
responses, timeouts, wrong destinations and definite rejections are held, never
automatically retried. A process interrupted after claiming stays fenced as
`sending` / `send_in_flight_or_unknown`; this is not a confirmed delivery.

Queued posts are spaced three seconds apart within a page. Telegram rate limits
still apply; a rejected rate-limited send is held instead of retried. No paid
broadcast option is enabled. Sent/held rows discard source text while retaining
deduplication/receipt metadata. No public relay diagnostics endpoint is exposed.

`xTelegramRelayData:disable` stops new admissions and holds queued deliveries
when claimed. It never resets X cursors or changes any historical hold. There
is deliberately no automatic replay, lease reset, refund or cutoff-reset API.

Tests: `bunx vitest run convex/xTelegramRelay.test.ts convex/xAgentActivity.test.ts`.
