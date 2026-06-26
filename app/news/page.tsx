import { NewsFeed } from "@/components/news-feed";
import { SectionHeader } from "@/components/section-header";
import { getLiveHnFallback, getNewsTimeline } from "@/lib/news-data";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "News",
};

export default async function NewsPage() {
  const convexEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const [initialTimeline, initialStories] = await Promise.all([
    convexEnabled ? getNewsTimeline() : Promise.resolve(null),
    convexEnabled ? Promise.resolve([]) : getLiveHnFallback(30),
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
