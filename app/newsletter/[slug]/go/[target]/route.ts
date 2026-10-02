import {
  convexRefs,
  type PublicNewsletterDestinationRecord,
} from "@/lib/convex-refs";
import { getServerConvexClient } from "@/lib/server-convex";
import { NextResponse, type NextRequest } from "next/server";

const VISITOR_COOKIE = "sym_nl_vid";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string; target: string }> },
) {
  const { slug, target } = await context.params;
  const convex = getServerConvexClient();
  if (convex === null) {
    return NextResponse.redirect(new URL("/newsletter", request.url));
  }
  const existingVisitor = request.cookies.get(VISITOR_COOKIE)?.value;
  const visitorKey = existingVisitor ?? crypto.randomUUID();
  let destination: PublicNewsletterDestinationRecord | null;
  try {
    const result = await convex.mutation(
      convexRefs.newsletter.resolveAndRecordPublicEngagement,
      { slug, target, visitorKey },
    );
    destination = result.destination;
  } catch {
    // The event mutation may have committed before its response failed, and a
    // second write would contend on the same limiter. Keep redirect
    // availability; engagement tracking is best-effort on this error path.
    destination = await convex.query(
      convexRefs.newsletter.resolvePublicDestination,
      { slug, target },
    );
  }
  if (destination === null) {
    return NextResponse.redirect(new URL(`/newsletter/${slug}`, request.url));
  }

  const response = NextResponse.redirect(destination.url);
  if (!existingVisitor) {
    response.cookies.set(VISITOR_COOKIE, visitorKey, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return response;
}
