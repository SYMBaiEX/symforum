import { convexRefs } from "@/lib/convex-refs";
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
  const destination = await convex.query(
    convexRefs.newsletter.resolvePublicDestination,
    { slug, target },
  );
  if (destination === null) {
    return NextResponse.redirect(new URL(`/newsletter/${slug}`, request.url));
  }
  const existingVisitor = request.cookies.get(VISITOR_COOKIE)?.value;
  const visitorKey = existingVisitor ?? crypto.randomUUID();
  await convex
    .mutation(convexRefs.newsletter.recordPublicEngagement, {
      slug,
      eventType: destination.eventType,
      hnItemId: destination.hnItemId,
      visitorKey,
    })
    .catch(() => undefined);

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
