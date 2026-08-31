# Newsletter operations

## Trusted link origin

Confirmation, manage-subscription, and welcome email links use only the typed
Convex `NEWSLETTER_SITE_URL`, then typed `SITE_URL`, and finally the canonical
`https://symbaiex.com` fallback. Public route hosts and caller-provided
`siteUrl` values are intentionally ignored for scheduled emails. Set
`NEWSLETTER_SITE_URL` to the canonical production origin (or `SITE_URL` only
when that is the intended canonical origin) before enabling delivery.

## Contact delivery lifecycle

Contact notifications use the mounted `@convex-dev/resend` queue. Each contact
request stores the component email id and lifecycle state; callback events are
deduplicated by component email id, event type, and provider timestamp. The
callback ledger contains only those identifiers and event type, not recipient
addresses or provider payload metadata. A queued state means the component
accepted the notification; it is not proof of final provider delivery.
