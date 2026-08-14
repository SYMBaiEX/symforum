import { NewsFeed } from "@/components/news-feed";
import { SectionHeader } from "@/components/section-header";
import { StructuredData } from "@/components/structured-data";
import { getLiveHnFallback, getNewsTimeline } from "@/lib/news-data";
import type { Metadata } from "next";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";

export const metadata: Metadata = {
  title: "News",
  description:
    "Daily index of top Hacker News stories with on-site votes, saves, and comments.",
  alternates: { canonical: "/news" },
  openGraph: {
    type: "website",
    url: primarySiteUrl("/news"),
    title: "News",
    description:
      "Daily index of top Hacker News stories with on-site votes, saves, and comments.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX daily news index and signal collection.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Daily news index",
    description:
      "Daily index of top Hacker News stories with on-site votes, saves, and comments.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX daily news index and signal collection.",
      },
    ],
  },
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
        <StructuredData
          data={breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "News", url: primarySiteUrl("/news") },
          ])}
        />
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
