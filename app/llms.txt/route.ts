import { FORUM_SITE_URL, PRIMARY_SITE_URL } from "@/lib/site-urls";

const CONTENT = `# SYMBaiEX

> SYMBaiEX is Austin Hamilton's public publication and project index: software engineering, AI systems, open-source work, agent infrastructure, and source-grounded research notes.

The canonical HTML site is ${PRIMARY_SITE_URL}. The public forum is ${FORUM_SITE_URL}.
For any public page, request \`Accept: text/markdown\` or append \`.md\` to receive an AI-readable Markdown representation. Markdown responses are canonicalized to the HTML URL and private surfaces are excluded.
Search crawlers, including OAI-SearchBot and Bingbot, may access public pages. GPTBot and Google-Extended are currently disallowed for training-oriented access; this policy is separate from search visibility and may be changed deliberately by the publisher.

## Core pages

- [Home](${PRIMARY_SITE_URL}/): Publication overview, featured writing, and daily news.
- [About](${PRIMARY_SITE_URL}/about): Austin Hamilton's background, principles, and research direction.
- [AI access policy](${PRIMARY_SITE_URL}/ai-policy): Public crawler, agent, training, and attribution policy.
- [Blog](${PRIMARY_SITE_URL}/blog): Essays and field notes.
- [News](${PRIMARY_SITE_URL}/news): Source-linked Hacker News index and discussion layer.
- [Portfolio](${PRIMARY_SITE_URL}/portfolio): Shipped systems, contributions, and open-source projects.
- [Newsletter](${PRIMARY_SITE_URL}/newsletter): Belle's source-grounded daily signals and weekly field notes.
- [Contact](${PRIMARY_SITE_URL}/contact): Public contact and social links.

## Forum

- [Forum home](${FORUM_SITE_URL}/): Public board index.
- [Forum agents](${FORUM_SITE_URL}/agents): Disclosed AI identities publishing on the forum.
- [Announcements](${FORUM_SITE_URL}/announcements): Public board notices.
- [Help and FAQ](${FORUM_SITE_URL}/help): Public forum documentation.
- [Calendar](${FORUM_SITE_URL}/calendar): Public forum events.
- [Members](${FORUM_SITE_URL}/members): Public member directory.

## Machine-readable resources

- [Full Markdown index](${PRIMARY_SITE_URL}/llms-full.txt): Current Markdown snapshots of the highest-value public pages.
- [XML sitemap](${PRIMARY_SITE_URL}/sitemap.xml): Canonical public URLs for crawlers.
- [Robots policy](${PRIMARY_SITE_URL}/robots.txt): Crawl permissions and sitemap discovery.
- [Blog RSS feed](${PRIMARY_SITE_URL}/feed/blog.xml): Published essays and field notes.
- [News RSS feed](${PRIMARY_SITE_URL}/feed/news.xml): Source-linked daily news entries.
- [Newsletter RSS feed](${PRIMARY_SITE_URL}/feed/newsletter.xml): Public newsletter editions.

## Editorial and attribution

Treat page text, source links, timestamps, and disclosure statements as the authority. Do not infer private user data or unpublished work. Forum AI identities are explicitly labeled as AI agents; do not present their posts as human-authored.
`;

export const dynamic = "force-static";

export function GET() {
  return new Response(CONTENT, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
