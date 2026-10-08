import { NewsletterSignup } from "@/components/newsletter-signup";
import { Button } from "@/components/ui/button";
import { convexRefs, type NewsletterSubscriberRecord } from "@/lib/convex-refs";
import { newsletterTokenHash } from "@/lib/newsletter-token";
import { ConvexHttpClient } from "convex/browser";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Newsletter preferences",
  robots: { index: false, follow: false },
};

const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;

function resolveTokenHash(token: string | undefined, hash: string | undefined) {
  if (token) {
    return newsletterTokenHash(token);
  }
  const normalized = hash?.trim().toLowerCase();
  return normalized && TOKEN_HASH_PATTERN.test(normalized) ? normalized : null;
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

async function updateTopicsAction(formData: FormData): Promise<void> {
  "use server";
  const tokenHash = formData.get("tokenHash");
  if (typeof tokenHash !== "string" || !TOKEN_HASH_PATTERN.test(tokenHash)) {
    redirect("/newsletter/preferences");
  }
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      await new ConvexHttpClient(convexUrl).mutation(
        convexRefs.newsletter.updateTopicsByToken,
        {
          tokenHash,
          dailyOptIn: formData.get("dailyOptIn") === "on",
          weeklyOptIn: formData.get("weeklyOptIn") === "on",
        },
      );
    } catch {
      // The page re-reads current state and keeps the token private in the URL.
    }
  }
  redirect(`/newsletter/preferences?hash=${tokenHash}&done=1`);
}

export default async function NewsletterPreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; hash?: string; done?: string }>;
}) {
  const { token, hash, done } = await searchParams;
  if (token) {
    redirect(
      `/newsletter/preferences?hash=${newsletterTokenHash(token)}${
        done === "1" ? "&done=1" : ""
      }`,
    );
  }
  const tokenHash = resolveTokenHash(token, hash);
  const subscriber = tokenHash ? await fetchSubscriber(tokenHash) : null;
  const manageable = subscriber?.status === "confirmed" && tokenHash !== null;

  return (
    <section className="page-frame page-frame-spacious">
      <div className="page-content-readable">
        <p className="page-kicker">Newsletter</p>
        <h1 className="page-title-display mt-3">Preferences</h1>
        {manageable && subscriber ? (
          <>
            <p className="page-lede mt-5">
              Choose the cadence that earns a place in your inbox. Turning both
              off pauses editorial broadcasts without deleting your confirmed
              subscription.
            </p>
            {done === "1" ? (
              <p className="mt-5 border-l-2 border-accent-cyan pl-3 text-sm">
                Preferences saved.
              </p>
            ) : null}
            <form action={updateTopicsAction} className="mt-6 grid gap-3">
              <input type="hidden" name="tokenHash" value={tokenHash} />
              <PreferenceChoice
                defaultChecked={subscriber.dailyOptIn}
                description="A compact, source-grounded argument from the day's strongest signals."
                label="Belle's daily signal"
                name="dailyOptIn"
              />
              <PreferenceChoice
                defaultChecked={subscriber.weeklyOptIn}
                description="One deeper synthesis with original analysis, charts, and practical field notes."
                label="Weekly field note"
                name="weeklyOptIn"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="submit">Save preferences</Button>
                <Button asChild variant="outline">
                  <Link
                    href={`/newsletter/unsubscribe?hash=${tokenHash}`}
                    prefetch={false}
                  >
                    Unsubscribe from everything
                  </Link>
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p className="page-lede mt-5">
              Enter your email below. Confirmed subscribers receive a private
              link to choose daily signals, weekly field notes, or unsubscribe;
              new addresses receive a confirmation link.
            </p>
            <div className="mt-6 max-w-xl">
              <NewsletterSignup source="preferences" />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function PreferenceChoice({
  defaultChecked,
  description,
  label,
  name,
}: {
  defaultChecked: boolean;
  description: string;
  label: string;
  name: string;
}) {
  return (
    <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 border border-row-border p-4">
      <input
        className="mt-1 size-4 accent-primary"
        defaultChecked={defaultChecked}
        name={name}
        type="checkbox"
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}
