import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { NextRequest } from "next/server";

const refreshTopStories = makeFunctionReference<
  "action",
  { limit?: number },
  { snapshotDate: string; storyCount: number }
>("news:refreshTopStories");

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (process.env.VERCEL_ENV === "production" && !cronSecret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET must be configured in production" },
      { status: 500 },
    );
  }

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return Response.json(
      { ok: false, error: "NEXT_PUBLIC_CONVEX_URL is not configured" },
      { status: 503 },
    );
  }

  const client = new ConvexHttpClient(convexUrl);
  const result = await client.action(refreshTopStories, {});
  return Response.json({ ok: true, ...result });
}
