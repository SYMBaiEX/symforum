# Newsletter operations

## Trusted link origin

Confirmation, manage-subscription, and welcome email links use only the typed
Convex `NEWSLETTER_SITE_URL`, then typed `SITE_URL`, and finally the canonical
`https://symbaiex.com` fallback. Public route hosts and caller-provided
`siteUrl` values are intentionally ignored for scheduled emails. Set
`NEWSLETTER_SITE_URL` to the canonical production origin (or `SITE_URL` only
when that is the intended canonical origin) before enabling delivery.
