import { Button } from "@/components/ui/button";
import { convexRefs } from "@/lib/convex-refs";
import { newsletterTokenHash } from "@/lib/newsletter-token";
import { ConvexHttpClient } from "convex/browser";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewsletterUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; hash?: string }>;
}) {
  const { token, hash } = await searchParams;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const tokenHash = hash || (token ? newsletterTokenHash(token) : null);
  const result =
    tokenHash && convexUrl
      ? await new ConvexHttpClient(convexUrl).mutation(
          convexRefs.newsletter.unsubscribe,
          { tokenHash },
        )
      : { ok: false, subscriber: null };

  return (
    <section className="page-frame page-frame-spacious">
      <div className="page-content-readable">
        <p className="page-kicker">Newsletter</p>
        <h1 className="page-title-display mt-3">
          {result.ok ? "Unsubscribed" : "Could not unsubscribe"}
        </h1>
        <p className="page-lede mt-5">
          {result.ok
            ? "This email is removed from future SYMBaiEX broadcasts."
            : "This unsubscribe link could not be matched. You can reply to any newsletter issue for manual removal."}
        </p>
        <div className="mt-6">
          <Button asChild variant="outline">
            <Link href="/">Back home</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
