import ConvexClientProvider from "@/components/ConvexClientProvider";
import { NewsFeed } from "@/components/news-feed";
import { SectionHeader } from "@/components/section-header";
import { SiteShell } from "@/components/site-shell";
import { fetchHnTopStories } from "@/lib/hn";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "News",
};

export default async function NewsPage() {
  const convexEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const initialStories = await fetchHnTopStories(30);

  return (
    <SiteShell>
      <section className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-24">
        <SectionHeader title="Daily news" divided={false} />
        <div className="mt-8">
          {convexEnabled ? (
            <ConvexClientProvider>
              <NewsFeed
                enabled={convexEnabled}
                initialStories={initialStories}
              />
            </ConvexClientProvider>
          ) : (
            <NewsFeed enabled={convexEnabled} initialStories={initialStories} />
          )}
        </div>
      </section>
    </SiteShell>
  );
}
