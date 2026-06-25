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
    <section className="mx-auto max-w-3xl px-4 py-12 md:px-8 md:py-16">
      <p className="font-mono text-xs uppercase text-muted-foreground">
        Newsletter
      </p>
      <h1 className="mt-3 text-4xl font-bold leading-none md:text-6xl">
        {result.ok ? "Confirmed" : "Link expired"}
      </h1>
      <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
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
    </section>
  );
}
