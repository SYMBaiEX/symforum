import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import { renderRssFeed, rssHeaders } from "@/lib/rss";
import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-dynamic";

export async function GET() {
  const issues = await getPublicNewsletterIssues(30);
  const items = issues.map((issue) => {
    const url = primarySiteUrl(
      `/newsletter/${encodeURIComponent(issue.slug)}`,
    );
    return {
      title: issue.subject,
      url,
      description: issue.previewText,
      publishedAt: issue.sentAt ?? issue.updatedAt,
    };
  });

  return new Response(
    renderRssFeed({
      title: "SYMBaiEX Newsletter",
      url: primarySiteUrl("/newsletter"),
      description: "Source-grounded SYMBaiEX editions.",
      items,
    }),
    { headers: rssHeaders() },
  );
}
