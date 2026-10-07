# Forum tool review investigation — 2026-10-06

The portal finding “This tool update needs further review before it can go live” is a held-update status, not a detailed explanation of the review concern. Server checks cannot establish OpenAI approval. Inspect the existing plugin's MCP **Issues → Held update** and **Live definition** before appealing; do not create a replacement plugin.

## Private-message report

`forum_create_private_message_report` previously had a generic description and `destructiveHint: false`. The backend copies a received legacy mailbox message's subject, body, sender identity and creation time into a persistent report visible to authorized forum moderators and administrators. That disclosure cannot be undone, so the corrected annotation is `destructiveHint: true`, with an explicit description of this side effect.

The other values remain accurate: `readOnlyHint: false` creates a report; `openWorldHint: false` is confined to the authenticated recipient's message and the bounded SYMBaiEX staff report queue, without arbitrary destinations. `idempotentHint: true` relies on the connection/actor/payload-bound command receipt. Current connection authorization, feedback consent, policy revision, recipient ownership, posting restrictions, report limits and owner review are enforced before the operation executes. Reporting does not itself delete a message or penalize the sender.

The schema now mirrors existing limits: reason 3–80 characters, optional details at most 1,000 characters. The request contains a message ID, not a caller-supplied transcript or snapshot. The newer group/direct conversation report remains a separate tool.

## Stored news feed

`forum_list_news_feed` executes a Convex query over SYMBaiEX's stored news editions. It does not perform HTTP requests, refresh imports, start jobs, persist state, post to Hacker News, or vote. It returns public story titles, source/discussion links, imported HN metrics and separate local interaction summaries. Local metrics can be unavailable; missing/incomplete editions return an empty story collection. Default limit is 12, accepted range 1–30. The MCP date schema now matches the backend's YYYY-MM-DD format check.

`readOnlyHint: true` and `destructiveHint: false` accurately describe the query. `openWorldHint: true` conservatively labels the public news content and external source links. The description now identifies SYMBaiEX's stored editions and distinguishes imported metrics from local forum activity. This is a component of SYMBaiEX's forum, not a tool for modifying or authenticating to Hacker News.

## Review follow-through

Deploy the corrected hosted catalog, verify both public MCP origins, then rescan the **existing** integration. No endpoint, OAuth resource, tool name, or package identity changes are needed. This correction does not require reinstalling the MCP or a replacement ZIP. If held again, appeal with the behavior and annotation explanations above plus current test evidence; the warning alone does not prove which detail caused the hold.

The current [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation) say annotation justifications are no longer required, although older submission/reference pages still describe them. Do not add undocumented MCP justification fields. These explanations are for reviewer clarification or an appeal, not an alternate authorization mechanism.

Hosted updates and appeals follow the [submission lifecycle](https://developers.openai.com/plugins/deploy/submission): tools are reviewed independently, held updates keep the previous approved definition, and automatic updates pause during an active appeal. Preserve compatibility and do not withdraw an active review or appeal merely to clear a warning.
