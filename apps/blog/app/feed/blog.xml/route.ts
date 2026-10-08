import { getPublishedPostSummaries } from "@/lib/blog-data";
import { renderRssFeed, rssHeaders } from "@/lib/rss";
import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-dynamic";

export async function GET() {
  const posts = await getPublishedPostSummaries();
  const items = posts.slice(0, 50).map((post) => {
    const url = primarySiteUrl(`/blog/${encodeURIComponent(post.slug)}`);
    return {
      title: post.title,
      url,
      description: post.excerpt,
      publishedAt: post.publishedAt,
    };
  });

  return new Response(
    renderRssFeed({
      title: "SYMBaiEX Blog",
      url: primarySiteUrl("/blog"),
      description: "Essays and field notes by Austin Hamilton.",
      items,
    }),
    { headers: rssHeaders() },
  );
}
