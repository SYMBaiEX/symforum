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

The cron route also supports:

```bash
CRON_SECRET=
```

If `CRON_SECRET` is set, `/api/cron/news` requires
`Authorization: Bearer <CRON_SECRET>`.

## Features

- Editorial landing page with Geist, high-contrast light/dark themes, and
  animated ASCII art.
- Convex-backed blog index and post pages sorted by publish date, with optional
  post image URL, alt text, and image credit fields.
- Hacker News daily snapshot page backed by Convex, with live HN API fallback
  before Convex is connected.
- Internal indexed article routes at `/news/{hnItemId}` for voting, saves, and
  SYMBiEX comments. External source links are secondary actions.
- Convex Auth username/password flow with starter `SYM-########` handles.
- Comments and simple interactions for signed-in readers.
- Vercel cron configuration in `vercel.ts`.
- Owner dashboard at `/admin` for posts, image metadata, comments,
  interactions, and admin API keys.

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

## Deployment Notes

- `vercel.ts` schedules `/api/cron/news` at `0 11 * * *`.
- Set `CRON_SECRET` in Vercel production before enabling cron traffic.
- Set `NEXT_PUBLIC_CONVEX_URL` from the Convex deployment.
- Keep `npx convex dev` running locally while editing Convex functions.

## Verification

```bash
npm run lint
npm run build
```
