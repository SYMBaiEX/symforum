import { Button } from "@/components/ui/button";
import { convexRefs, type NewsletterSubscriberRecord } from "@/lib/convex-refs";
import { newsletterTokenHash } from "@/lib/newsletter-token";
import { ConvexHttpClient } from "convex/browser";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Newsletter unsubscribe",
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

async function unsubscribeAction(formData: FormData): Promise<void> {
  "use server";
  const tokenHash = formData.get("tokenHash");
  if (typeof tokenHash !== "string" || !TOKEN_HASH_PATTERN.test(tokenHash)) {
    redirect("/newsletter/unsubscribe");
  }
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      await new ConvexHttpClient(convexUrl).mutation(
        convexRefs.newsletter.unsubscribe,
        { tokenHash },
      );
    } catch {
      // Ignore; the reloaded page re-reads state and shows the best message.
    }
  }
  redirect(`/newsletter/unsubscribe?hash=${tokenHash}&done=1`);
}

export default async function NewsletterUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; hash?: string; done?: string }>;
}) {
  const { token, hash, done } = await searchParams;
  const tokenHash = resolveTokenHash(token, hash);
  const subscriber = tokenHash ? await fetchSubscriber(tokenHash) : null;

  const matched = Boolean(tokenHash && subscriber);
  const unsubscribed = subscriber?.status === "unsubscribed";
  const showConfirm = matched && !unsubscribed && Boolean(tokenHash);

  let title: string;
  let lede: string;
  if (!matched) {
    title = "Could not unsubscribe";
    lede =
      "This unsubscribe link could not be matched. You can reply to any newsletter issue for manual removal.";
  } else if (unsubscribed) {
    title = "Unsubscribed";
    lede =
      done === "1"
        ? "You are removed from future SYMBaiEX broadcasts."
        : "This email is already removed from future SYMBaiEX broadcasts.";
  } else {
    title = "Confirm unsubscribe";
    lede =
      "Removing this email stops all future SYMBaiEX broadcasts. Confirm below to unsubscribe.";
  }

  return (
    <section className="page-frame page-frame-dense newsletter-page">
      <div className="forum-panel newsletter-transaction-card page-content-readable p-4 md:p-5">
        <p className="page-kicker text-primary">Newsletter</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{lede}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {showConfirm && tokenHash ? (
            <form action={unsubscribeAction}>
              <input type="hidden" name="tokenHash" value={tokenHash} />
              <Button type="submit">Yes, unsubscribe me</Button>
            </form>
          ) : null}
          <Button asChild variant="outline">
            <Link href="/" prefetch>
              Back home
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
