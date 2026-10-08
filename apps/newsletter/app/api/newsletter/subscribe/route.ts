import { convexRefs } from "@/lib/convex-refs";
import {
  createNewsletterToken,
  newsletterTokenHash,
} from "@/lib/newsletter-token";
import { recordSystemLog, requestLogContext } from "@/lib/system-log-server";
import { ConvexHttpClient } from "convex/browser";
import { after, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      return NextResponse.json(
        { ok: false, error: "Newsletter is not configured yet" },
        { status: 503 },
      );
    }
    const payload = (await request.json()) as {
      email?: unknown;
      source?: unknown;
    };
    if (typeof payload.email !== "string") {
      return NextResponse.json(
        { ok: false, error: "Email is required" },
        { status: 400 },
      );
    }

    const token = createNewsletterToken();
    const convex = new ConvexHttpClient(convexUrl);
    const subscriber = await convex.mutation(convexRefs.newsletter.subscribe, {
      email: payload.email,
      source: typeof payload.source === "string" ? payload.source : "site",
      token,
      tokenHash: newsletterTokenHash(token),
    });

    return NextResponse.json(
      {
        ok: true,
        subscriber,
        message:
          subscriber.status === "confirmed"
            ? "Check your inbox for a link to manage your subscription."
            : "Check your inbox to confirm.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    after(() =>
      recordSystemLog({
        level: "warn",
        source: "server",
        scope: "newsletter-api",
        eventType: "subscribe_failed",
        message: error instanceof Error ? error.message : "Could not subscribe",
        name: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined,
        statusCode: 400,
        fingerprint: [
          "newsletter-api",
          "subscribe_failed",
          error instanceof Error ? error.message : "unknown",
        ].join("|"),
        ...requestLogContext(request),
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not subscribe",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
