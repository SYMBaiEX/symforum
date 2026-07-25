# SYMBiEX Blog

Personal blog for Austin Hamilton ("SYMBiEX") built with Next.js, shadcn/ui,
Convex, Convex Auth, and Vercel.

## Local Development

Install dependencies:

```bash
npm install
```

Run only the frontend:

```bash
npm run dev:frontend
```

Run Convex locally in another terminal:

```bash
npx convex dev
```

Run both after Convex has been configured:

```bash
npm run dev
```

## Environment

Next.js needs:

```bash
NEXT_PUBLIC_CONVEX_URL=
```

Convex Auth needs `SITE_URL` plus the provider credentials in each Convex
deployment:

```bash
SITE_URL=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
```

Create Google OAuth credentials as a **Web application**. For the current
deployments, configure:

| Environment | Authorized JavaScript origins                                                    | Authorized redirect URI                                               |
| ----------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Development | `http://localhost:3000`                                                          | `https://dependable-warbler-666.convex.site/api/auth/callback/google` |
| Production  | `https://symbaiex.com`, `https://www.symbaiex.com`, `https://forum.symbaiex.com` | `https://strong-bee-384.convex.site/api/auth/callback/google`         |

Google sign-in returns to the same approved site origin that started the flow.

## Features

- Editorial landing page with Geist, high-contrast light/dark themes, and
  animated ASCII art.
- Convex-backed blog index and post pages sorted by publish date, with optional
  post image URL, alt text, and image credit fields.
- Hacker News daily snapshot page backed by Convex, with live HN API fallback
  before Convex is connected.
- Internal indexed article routes at `/news/{hnItemId}` for voting, saves, and
  SYMBiEX comments. External source links are secondary actions.
- Persistent 30-day Convex Auth sessions with Google OAuth or username/password
  starter `SYM-########` handles.
- Comments and simple interactions for signed-in readers.
- Internal Convex cron jobs for news, portfolio metrics, and daily newsletters.
- Role-based admin dashboard at `/admin`: owners manage identities and API keys;
  administrators manage content and operations.

## Admin API

Create an API key in `/admin`, then send it as
`Authorization: Bearer <token>`.

```text
GET    /api/admin/posts
POST   /api/admin/posts
GET    /api/admin/posts/[slug]
PATCH  /api/admin/posts/[slug]
PUT    /api/admin/posts/[slug]
DELETE /api/admin/posts/[slug]
GET    /api/admin/interactions
DELETE /api/admin/comments/[commentId]
DELETE /api/admin/interactions/[interactionId]
```

Post payloads accept `title`, `excerpt`, `body`, `tags`, `status`,
`publishedAt`, `readingMinutes`, `featured`, `imageUrl`, `imageAlt`, and
`imageCredit`. If `slug` is omitted, it is generated from the article title.

## Authorization Model

- Public queries return only published content.
- Reader writes derive the user ID from the active Convex Auth session and
  validate that their target is a real public row.
- Site administrators can manage content, moderation, analytics, system logs,
  newsletters, and contact requests.
- Owners alone can change user roles and manage admin API keys.
- Scheduled write jobs are internal Convex functions and cannot be called by
  unauthenticated clients.

## Deployment Notes

- Set `NEXT_PUBLIC_CONVEX_URL` from the Convex deployment.
- Set `SITE_URL`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET` separately in the
  development and production Convex deployments.
- Keep `npx convex dev` running locally while editing Convex functions.

## Verification

```bash
npm run lint
npm run build
```
