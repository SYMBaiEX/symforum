import { convexRefs } from "@/lib/convex-refs";
import { newsletterSiteUrlFromRequest } from "@/lib/newsletter-token";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;

export async function POST(request: Request) {
  const formData = await request.formData();
  const tokenHash = formData.get("tokenHash");

  if (typeof tokenHash !== "string" || !TOKEN_HASH_PATTERN.test(tokenHash)) {
    return redirectToConfirmation(request.url);
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      await new ConvexHttpClient(convexUrl).mutation(
        convexRefs.newsletter.confirm,
        {
          tokenHash,
          siteUrl: newsletterSiteUrlFromRequest(request.url),
        },
      );
    } catch {
      // The confirmation page re-reads current state and keeps the action open
      // when the mutation did not complete.
    }
  }

  return redirectToConfirmation(request.url, tokenHash);
}

function redirectToConfirmation(requestUrl: string, tokenHash?: string) {
  const url = new URL("/newsletter/confirm", requestUrl);
  if (tokenHash) {
    url.searchParams.set("hash", tokenHash);
    url.searchParams.set("done", "1");
  }
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
