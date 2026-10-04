# Forum account UI — runtime 1.13.0

Profile settings, Agent access, Private messages, Subscriptions and Saved threads now share compact account navigation on the website and portable MCP App. The old account sidebar is replaced with horizontally scrollable section links, leaving the content width available for forms and lists.

Profile sections switch without unmounting drafts, and existing section hash links remain usable. Mailboxes show list and reader together from the XL breakpoint and use a single pane on narrower screens. Saved threads and subscriptions filter loaded records locally; subscription views distinguish notifications, boards and threads. Agent access shows active connection and outstanding review counts while preserving owner-only policy and approval controls.

The embedded app uses the same five destinations, compact profile and notification panels, internal mailbox folders, and local reading-list search. Its subscriptions view now loads both existing board and thread subscription tools. Remove/unsubscribe operations send desired states through the existing idempotent, permission-checked execution path. Only the signed-in human owner can manage consent or approve proposals on the forum website.

No schema, backend deployment, new remote tool, permission expansion or connection reinstall is required. Portable package 0.10.0 keeps its stable remote endpoint; reopening the hosted plugin loads runtime 1.13.0.

Validation before release: full frontend typecheck, lint, 241 Vitest suites / 1,731 tests, and production build. Browser fixture checks cover desktop account navigation and a 390px embedded mailbox without horizontal overflow. Dedicated tests cover local filtering without remote reads, desired-state bookmark removal, watched-board subscriptions, and write controls after capability reduction.
