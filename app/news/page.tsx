import { NewsFeed } from "@/components/news-feed";
import { StructuredData } from "@/components/structured-data";
import { getNewsPageData } from "@/lib/news-data";
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
  const { initialTimeline, initialStories } = await getNewsPageData(30);

  return (
    <>
      <section className="page-frame page-frame-spacious max-w-[820px]">
        <StructuredData
          data={breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "News", url: primarySiteUrl("/news") },
          ])}
        />
        <header className="px-3 sm:px-4">
          <p className="mb-3 text-xs font-medium text-primary">
            Hacker News, with the SYMBaiEX community
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            The daily read
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
            Explore today’s stories. Follow the source or join the discussion
            here.
          </p>
        </header>
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
