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
- Blog index and static blog post pages sorted by publish date.
- Hacker News daily snapshot page backed by Convex, with live HN API fallback
  before Convex is connected.
- Internal indexed article routes at `/news/{hnItemId}` for voting, saves, and
  SYMBiEX comments. External source links are secondary actions.
- Convex Auth username/password flow with starter `SYM-########` handles.
- Comments and simple interactions for signed-in readers.
- Vercel cron configuration in `vercel.ts`.

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
