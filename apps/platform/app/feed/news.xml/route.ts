import { getDailyNews } from "@/lib/news-data";
import { newsStoryPath } from "@/lib/news-slugs";
import { renderRssFeed, rssHeaders } from "@/lib/rss";
import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-dynamic";

export async function GET() {
  const stories = await getDailyNews(30);
  const items = stories.map((story) => {
    const url = primarySiteUrl(newsStoryPath(story));
    return {
      title: story.title,
      url,
      description: story.host ?? "SYMBaiEX News",
      publishedAt: story.timePosted ? story.timePosted * 1000 : undefined,
    };
  });

  return new Response(
    renderRssFeed({
      title: "SYMBaiEX News",
      url: primarySiteUrl("/news"),
      description: "Daily source-linked news and discussion.",
      items,
    }),
    { headers: rssHeaders() },
  );
}
