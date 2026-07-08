import { NewsFeed } from "@/components/news-feed";
import { SectionHeader } from "@/components/section-header";
import { getLiveHnFallback, getNewsTimeline } from "@/lib/news-data";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "News",
  description:
    "Daily index of top Hacker News stories with on-site votes, saves, and comments.",
};

export default async function NewsPage() {
  const convexEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const [initialTimeline, initialStories] = await Promise.all([
    convexEnabled ? getNewsTimeline() : Promise.resolve(null),
    getLiveHnFallback(30).catch((error) => {
      console.warn("Unable to load live HN stories", error);
      return [];
    }),
  ]);

  return (
    <>
      <section className="page-frame page-frame-spacious">
        <SectionHeader title="Daily news" divided={false} />
        <div className="mt-8">
          <NewsFeed
            enabled={convexEnabled}
            initialStories={initialStories}
            initialTimeline={initialTimeline}
          />
        </div>
      </section>
    </>
  );
}
