# Human sessions across SYMBaiEX hosts

With `NEXT_PUBLIC_WORKOS_ENABLED` absent or false, the shared provider uses the
existing Convex Auth server/client providers and login actions. Its production
cookies have the `__Host-` prefix and its local storage belongs to the current
origin. Without the shared envelope, signing in on `www.symbaiex.com` does not
sign in on `forum.symbaiex.com`, even when both hosts serve the same deployment. Do not add
a Domain attribute to those cookies: browsers prohibit it for `__Host-` cookies.

## Existing Convex accounts

Set the same server-only `AUTH_SHARED_SESSION_SECRET` on all trusted production
apps. Generate a cryptographically random 32-byte value encoded as 64 hex
characters. Keep it in deployment secret storage; never use `NEXT_PUBLIC_`,
source control, browser storage, or logs. Leave it absent on localhost/previews.

The shared proxy encrypts the existing access/refresh-token pair with AES-GCM
in a separate `__Secure-symbaiex-session` cookie with HttpOnly, Secure,
SameSite=Lax, Path=/ and Domain=.symbaiex.com. It accepts this envelope only on
the six exact HTTPS hosts: apex, www, forum, blog, news and newsletter. It binds
encryption to the version, purpose, cookie domain and Convex backend URL, limits
the cookie value to 3,800 bytes, and checks its 30-day expiration. The SDK still
validates/refreshes the underlying session against Convex.

Visiting an already signed-in host promotes its existing session automatically;
the next sibling navigation restores the session into the server request before
the SDK reads it. Refresh updates the shared envelope. Sign-out revokes the
session through the existing SDK and writes an encrypted signed-out marker so
stale host cookies cannot republish it. Original `__Host-` cookies stay host-only.
Refresh tokens remain server-only; the SDK's browser response retains its usual
nonsecret refresh marker. Unsafe cross-origin requests using browser sessions
are rejected. Remote MCP, bearer APIs, OAuth token/registration endpoints and
discovery routes bypass both shared cookies and the browser auth SDK. Among API
routes, only `/api/auth` and its children, `/api/admin/ai`,
`/api/admin/telemetry/model`, and `/api/plugin/forum/attachments` restore human
sessions. New human cookie APIs must be added to this explicit list. A shared
secret change invalidates envelopes; existing host sessions can repopulate them.

Verify primary-to-forum navigation with an existing account, token refresh, and
sign-out followed by navigation back to a previously signed-in sibling. The
SDK integration tests cover real Next.js request stores, refresh and logout with
mocked backend calls. They do not establish live authenticated browser behavior.

## Optional WorkOS human authentication

WorkOS AuthKit supports sharing its encrypted session cookie. Before enabling
human WorkOS authentication, configure every app deployment with:

- The same `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD` (at least
  32 characters) and default session cookie name. Keep the keys/password secret.
- `WORKOS_COOKIE_DOMAIN=.symbaiex.com` for the trusted production sibling hosts.
  Leave this empty for localhost and preview domains.
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://<app-host>/callback`, registered in the
  WorkOS dashboard. AuthKit Next.js 4.4 reads this exact variable; the private
  `WORKOS_REDIRECT_URI` variable is not a replacement.
- `NEXT_PUBLIC_WORKOS_ENABLED=true`, after verifying migration of existing
  accounts, callback and logout URIs, and configuring `WORKOS_CLIENT_ID` in the
  shared Convex backend. Rebuild so the public flag reaches the browser bundle.

The shared proxy and auth routes reject an enabled WorkOS configuration with
missing credentials, an invalid callback or the wrong cookie domain. Errors
name settings without printing their values. The SDK retains ownership of
session encryption, PKCE, refresh and sign-out cookie deletion. Agent OAuth
settings such as `WORKOS_CONNECT_ENABLED` do not enable human AuthKit sessions
and do not grant forum permissions.

Verify with a browser: sign in on the primary site, open the forum, check the
same human account, refresh after token expiry, and sign out from each host.
Check the encrypted session cookie has Domain `symbaiex.com`, Secure, HttpOnly
and SameSite=Lax. A deployment with matching settings alone does not prove this
authenticated roundtrip. Existing host-only cookies do not migrate themselves;
users sign in through AuthKit after the account migration is ready.
