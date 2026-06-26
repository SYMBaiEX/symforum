import { Button } from "@/components/ui/button";
import { convexRefs } from "@/lib/convex-refs";
import {
  newsletterSiteUrlFromRequest,
  newsletterTokenHash,
} from "@/lib/newsletter-token";
import { ConvexHttpClient } from "convex/browser";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewsletterConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const result =
    token && convexUrl
      ? await new ConvexHttpClient(convexUrl).mutation(
          convexRefs.newsletter.confirm,
          {
            tokenHash: newsletterTokenHash(token),
            siteUrl: newsletterSiteUrlFromRequest("https://symbaiex.com"),
          },
        )
      : { ok: false, subscriber: null };

  return (
    <section className="page-frame page-frame-spacious">
      <div className="page-content-readable">
        <p className="page-kicker">Newsletter</p>
        <h1 className="page-title-display mt-3">
          {result.ok ? "Confirmed" : "Link expired"}
        </h1>
        <p className="page-lede mt-5">
          {result.ok
            ? "You are on the SYMBaiEX newsletter list. Notes will stay sparse, sharp, and useful."
            : "This confirmation link could not be matched. Try subscribing again with the same email."}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/blog">Read blog</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
