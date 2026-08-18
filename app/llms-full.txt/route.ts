import { renderAiReadablePage } from "@/lib/ai-readable";
import { getPublishedPosts } from "@/lib/blog-data";
import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import { getDailyNews } from "@/lib/news-data";
import { newsStoryPath } from "@/lib/news-slugs";
import { PRIMARY_SITE_URL } from "@/lib/site-urls";

const INDEX_PATHS = [
  "/",
  "/about",
  "/ai-policy",
  "/agent",
  "/research",
  "/research/ai-readable-web",
  "/research/editorial-trust-and-contracts",
  "/research/methodology",
  "/blog",
  "/news",
  "/portfolio",
  "/newsletter",
  "/contact",
];

export const dynamic = "force-dynamic";

export async function GET() {
  const [posts, issues, stories] = await Promise.all([
    getPublishedPosts(),
    getPublicNewsletterIssues(3),
    getDailyNews(5),
  ]);
  const detailPaths = [
    ...posts
      .slice(0, 3)
      .map((post) => `/blog/${encodeURIComponent(post.slug)}`),
    ...issues
      .slice(0, 3)
      .map((issue) => `/newsletter/${encodeURIComponent(issue.slug)}`),
    ...stories.slice(0, 5).map((story) => newsStoryPath(story)),
  ];
  const pages = await Promise.all(
    [...INDEX_PATHS, ...detailPaths].map((pathname) =>
      renderAiReadablePage({ pathname }),
    ),
  );
  const sections = pages
    .filter((page): page is NonNullable<typeof page> => page !== null)
    .map((page) => `${page.markdown}\n\nSource: ${page.canonical}`);
  const content = [
    "# SYMBaiEX public content",
    "",
    "> A current Markdown bundle of the highest-value public pages. Individual pages remain available through content negotiation or their `.md` alias.",
    "",
    ...sections,
  ].join("\n\n---\n\n");

  return new Response(`${content.trim()}\n`, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      Link: `<${PRIMARY_SITE_URL}/llms.txt>; rel="describedby"`,
    },
  });
}
