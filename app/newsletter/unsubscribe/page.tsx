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
    <section className="mx-auto max-w-3xl px-4 py-12 md:px-8 md:py-16">
      <p className="font-mono text-xs uppercase text-muted-foreground">
        Newsletter
      </p>
      <h1 className="mt-3 text-4xl font-bold leading-none md:text-6xl">
        {result.ok ? "Unsubscribed" : "Could not unsubscribe"}
      </h1>
      <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
        {result.ok
          ? "This email is removed from future SYMBaiEX broadcasts."
          : "This unsubscribe link could not be matched. You can reply to any newsletter issue for manual removal."}
      </p>
      <div className="mt-6">
        <Button asChild variant="outline">
          <Link href="/">Back home</Link>
        </Button>
      </div>
    </section>
  );
}
