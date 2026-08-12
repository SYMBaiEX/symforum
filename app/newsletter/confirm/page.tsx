import { Button } from "@/components/ui/button";
import { convexRefs, type NewsletterSubscriberRecord } from "@/lib/convex-refs";
import { newsletterTokenHash } from "@/lib/newsletter-token";
import { ConvexHttpClient } from "convex/browser";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Newsletter confirmation",
  robots: { index: false, follow: false },
};

const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;

function resolveTokenHash(
  token: string | undefined,
  hash: string | undefined,
): string | null {
  if (token) {
    return newsletterTokenHash(token);
  }
  if (hash) {
    const normalized = hash.trim().toLowerCase();
    return TOKEN_HASH_PATTERN.test(normalized) ? normalized : null;
  }
  return null;
}

async function fetchSubscriber(
  tokenHash: string,
): Promise<NewsletterSubscriberRecord | null> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return null;
  }
  try {
    return await new ConvexHttpClient(convexUrl).query(
      convexRefs.newsletter.getByToken,
      { tokenHash },
    );
  } catch {
    return null;
  }
}

export default async function NewsletterConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; hash?: string; done?: string }>;
}) {
  const { token, hash } = await searchParams;
  const tokenHash = resolveTokenHash(token, hash);
  const subscriber = tokenHash ? await fetchSubscriber(tokenHash) : null;

  const matched = Boolean(tokenHash && subscriber);
  const confirmed = subscriber?.status === "confirmed";
  const showConfirm = matched && !confirmed && Boolean(tokenHash);

  let title: string;
  let lede: string;
  if (!matched) {
    title = "Link not recognized";
    lede =
      "This confirmation link could not be matched. If you subscribed more than once, use the link in the most recent email, or subscribe again.";
  } else if (confirmed) {
    title = "Confirmed";
    lede =
      "You are on the SYMBaiEX newsletter list. Notes will stay sparse, sharp, and useful.";
  } else {
    title = "Confirm subscription";
    lede =
      "One click confirms this inbox should receive SYMBaiEX notes. Confirm below to finish subscribing.";
  }

  return (
    <section className="page-frame page-frame-spacious">
      <div className="page-content-readable">
        <p className="page-kicker">Newsletter</p>
        <h1 className="page-title-display mt-3">{title}</h1>
        <p className="page-lede mt-5">{lede}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {showConfirm && tokenHash ? (
            <form action="/api/newsletter/confirm" method="post">
              <input type="hidden" name="tokenHash" value={tokenHash} />
              <Button type="submit">Confirm subscription</Button>
            </form>
          ) : null}
          <Button asChild>
            <Link href="/blog" prefetch>
              Read blog
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/" prefetch>
              Home
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
