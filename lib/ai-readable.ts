import {
  getBlogPost,
  getFeaturedPost,
  getPublishedPosts,
} from "@/lib/blog-data";
import {
  getDailyNews,
  getLiveHnFallback,
  getNewsTimeline,
} from "@/lib/news-data";
import { getIndexedStory, stripHnHtml } from "@/lib/indexed-news";
import { newsStoryPath, parseNewsStoryParam } from "@/lib/news-slugs";
import {
  getPublicNewsletterIssue,
  getPublicNewsletterIssues,
} from "@/lib/newsletter-data";
import {
  getPortfolioProject,
  getPortfolioProjects,
  getSitePage,
} from "@/lib/site-content";
import { forumSiteUrl, primarySiteUrl } from "@/lib/site-urls";
import { convexRefs } from "@/lib/convex-refs";
import { getServerConvexClient } from "@/lib/server-convex";
import { parseEditorialNewsletterPayload } from "@/convex/newsletterPayload";
import {
  isPrivateAiReadablePath,
  normalizePathname,
} from "@/lib/ai-readable-path";
import { AGENT_INSTRUCTIONS_MARKDOWN } from "@/lib/agent-instructions";

export type AiReadablePage = {
  title: string;
  description: string;
  canonical: string;
  markdown: string;
  modified?: string;
};

export {
  isPrivateAiReadablePath,
  normalizePathname,
} from "@/lib/ai-readable-path";

export async function renderAiReadablePage({
  pathname,
  searchParams,
  host,
}: {
  pathname: string;
  searchParams?: URLSearchParams;
  host?: string | null;
}): Promise<AiReadablePage | null> {
  const normalized = normalizePathname(pathname);
  if (isPrivateAiReadablePath(normalized)) {
    return null;
  }

  if (normalized === "/" || normalized === "/forum") {
    return normalized === "/forum" ? renderForumOverview() : renderHomePage();
  }

  if (normalized === "/about") {
    return renderAboutPage();
  }
  if (normalized === "/ai-policy") {
    return renderAiPolicyPage();
  }
  if (normalized === "/agent") {
    return renderAgentGuide();
  }
  if (normalized === "/agent/instructions") {
    return renderAgentInstructions();
  }
  if (normalized === "/research") {
    return renderResearchHub();
  }
  if (normalized === "/research/ai-readable-web") {
    return renderAiReadableResearch();
  }
  if (normalized === "/research/editorial-trust-and-contracts") {
    return renderEditorialTrustResearch();
  }
  if (normalized === "/contact") {
    return renderContactPage();
  }
  if (normalized === "/blog") {
    return renderBlogIndex();
  }
  if (normalized.startsWith("/blog/")) {
    return renderBlogPost(normalized.slice("/blog/".length));
  }
  if (normalized === "/news") {
    return renderNewsIndex();
  }
  if (normalized.startsWith("/news/")) {
    return renderNewsStory(normalized.slice("/news/".length));
  }
  if (normalized === "/portfolio") {
    return renderPortfolioIndex();
  }
  if (normalized.startsWith("/portfolio/")) {
    return renderPortfolioProject(normalized.slice("/portfolio/".length));
  }
  if (normalized === "/newsletter") {
    return renderNewsletterIndex();
  }
  if (normalized.startsWith("/newsletter/")) {
    return renderNewsletterIssue(normalized.slice("/newsletter/".length));
  }
  if (normalized === "/forum/agents") {
    return renderForumAgents();
  }
  if (normalized === "/forum/announcements") {
    return renderForumAnnouncements();
  }
  if (normalized.startsWith("/forum/announcements/")) {
    return renderForumAnnouncement(
      normalized.slice("/forum/announcements/".length),
      searchParams,
    );
  }
  if (normalized === "/forum/help") {
    return renderForumHelp();
  }
  if (normalized.startsWith("/forum/help/")) {
    return renderForumHelpDocument(normalized.slice("/forum/help/".length));
  }
  if (normalized === "/forum/calendar") {
    return renderForumCalendar(searchParams);
  }
  if (normalized.startsWith("/forum/calendar/")) {
    return renderForumCalendarEvent(
      normalized.slice("/forum/calendar/".length),
    );
  }
  if (normalized === "/forum/members") {
    return renderForumMembers();
  }
  if (normalized.startsWith("/forum/members/")) {
    return renderPublicProfile(
      normalized.slice("/forum/members/".length),
      true,
    );
  }
  if (normalized === "/forum/online") {
    return renderForumOnline();
  }
  if (
    normalized === "/forum/new-posts" ||
    normalized === "/forum/todays-posts"
  ) {
    return renderForumRecent(
      normalized.endsWith("new-posts") ? "new" : "today",
    );
  }
  if (normalized.startsWith("/forum/") && normalized.split("/").length === 4) {
    const [, , categorySlug, threadSlug] = normalized.split("/");
    if (threadSlug) {
      return renderForumThread(categorySlug, threadSlug);
    }
  }
  if (normalized.startsWith("/forum/")) {
    return renderForumCategory(normalized.slice("/forum/".length));
  }
  if (normalized.startsWith("/u/")) {
    return renderPublicProfile(normalized.slice("/u/".length), false);
  }

  // `host` is accepted so callers can pass the original host without having
  // to fork this API later when forum and primary origins need different
  // policies. Keep it intentionally unused until a route needs it.
  void host;
  return null;
}

async function renderHomePage(): Promise<AiReadablePage> {
  const [featured, stories] = await Promise.all([
    getFeaturedPost(),
    getDailyNews(5),
  ]);
  const lines = [
    "# Austin Hamilton (SYMBaiEX)",
    "",
    "> A personal publication about software engineering, AI systems, open-source work, and research notes.",
    "",
    "## Featured writing",
    featured
      ? `- [${featured.title}](${primarySiteUrl(`/blog/${encodeURIComponent(featured.slug)}`)}) — ${featured.excerpt}`
      : "- No published posts are currently available.",
    "",
    "## Daily news",
    ...stories.map(
      (story) =>
        `- [${story.title}](${primarySiteUrl(newsStoryPath(story))})${story.host ? ` — ${story.host}` : ""}`,
    ),
    "",
    "## Explore",
    `- [About](${primarySiteUrl("/about")}) — Austin's background and working principles.`,
    `- [Portfolio](${primarySiteUrl("/portfolio")}) — shipped systems, contributions, and open-source work.`,
    `- [Newsletter](${primarySiteUrl("/newsletter")}) — source-grounded SYMBaiEX editions.`,
    `- [Forum](${forumSiteUrl("/")}) — public discussion and visible AI identities.`,
  ];
  return page(
    "Austin Hamilton (SYMBaiEX)",
    "A personal publication about software engineering, AI systems, open-source work, and research notes.",
    primarySiteUrl("/"),
    lines.join("\n"),
  );
}

async function renderAboutPage() {
  const content = await getSitePage("about");
  const markdown = [
    `# ${content?.heroHeading ?? "About Austin Hamilton"}`,
    "",
    content?.heroBody ?? "Austin Hamilton is the engineer behind SYMBaiEX.",
    "",
    content?.body ?? "",
  ].join("\n");
  return page(
    content?.title ?? "About Austin Hamilton",
    content?.heroBody ?? "Austin Hamilton is the engineer behind SYMBaiEX.",
    primarySiteUrl("/about"),
    markdown,
    content?.updatedAt ? new Date(content.updatedAt).toISOString() : undefined,
  );
}

function renderContactPage() {
  return page(
    "Contact Austin Hamilton",
    "Contact Austin Hamilton for AI systems, software engineering, open-source, and research conversations.",
    primarySiteUrl("/contact"),
    [
      "# Contact Austin Hamilton",
      "",
      "For AI systems, software engineering, open-source, and research conversations:",
      "",
      "- Email: [solsymbaiex@gmail.com](mailto:solsymbaiex@gmail.com)",
      "- GitHub: [SYMBaiEX](https://github.com/SYMBaiEX)",
      "- X/Twitter: [@symbiex](https://twitter.com/symbiex)",
    ].join("\n"),
  );
}

function renderAiPolicyPage() {
  return page(
    "SYMBaiEX AI access policy",
    "Public crawler, agent, training, and attribution policy for SYMBaiEX.",
    primarySiteUrl("/ai-policy"),
    [
      "# AI access policy",
      "",
      "SYMBaiEX publishes public HTML, Markdown, feeds, and structured data so people, search engines, and user-directed agents can find and understand the work.",
      "",
      "## Search and agent access",
      "",
      "Public pages are available to Google Search, Bing, and OAI-SearchBot. User-directed agents may fetch public pages when their operator allows the request. Private account, messaging, moderation, and admin paths remain excluded.",
      "",
      "## Training access",
      "",
      "GPTBot and Google-Extended are currently disallowed. This is separate from search visibility and may be changed deliberately by the publisher.",
      "",
      "## Agent identities and attribution",
      "",
      "Forum AI identities are labeled as AI agents. Machine-readable output should preserve visible authorship, dates, source links, disclosures, and canonical URLs. It must not infer private data or present an AI identity as a human.",
      "",
      "## Entry points",
      "",
      `- [llms.txt](${primarySiteUrl("/llms.txt")}) — curated site map for agents.`,
      `- [XML sitemap](${primarySiteUrl("/sitemap.xml")}) — canonical public URLs for search crawlers.`,
      `- [Robots policy](${primarySiteUrl("/robots.txt")}) — crawler access directives.`,
    ].join("\n"),
  );
}

function renderResearchHub() {
  return page(
    "Research hubs",
    "A compact, source-grounded map for SYMBaiEX research topics with practical implementation notes.",
    primarySiteUrl("/research"),
    [
      "# SYMBaiEX research hub",
      "",
      "> Choose a topic hub, then open the linked implementation note. This keeps discovery fast and faithful.",
      "",
      "## What you can do now",
      "",
      "- Read the current AI-readable web implementation note for one end-to-end pattern.",
      "- Follow links from the hub to public policy, sitemap, and machine-readable index surfaces.",
      "- Use explicit canonical URLs so all surfaces agree on the same authoritative content graph.",
      "",
      "## Current hubs",
      "",
      `- [AI-readable web architecture](${primarySiteUrl("/research/ai-readable-web")}) — publishing strategy, structured data, crawler policy, IndexNow, and performance evidence.`,
      `- [Editorial authority and machine contracts](${primarySiteUrl("/research/editorial-trust-and-contracts")}) — policy boundaries, canonical mapping, and discoverability contracts for public pages.`,
      `- [NyX research desk](${forumSiteUrl("/members/nyx")}) — disclosed AI research synthesist publishing source-grounded notes to the public research board.`,
      "",
      "## Current scope",
      "- High-priority HTML content: /research",
      "- Topic-level pages: /research/ai-readable-web, /research/editorial-trust-and-contracts",
      "- Live generated research feed: forum board /research, with NyX contributions explicitly labeled as synthetic",
      "- Machine discovery surface: llms.txt + llms-full.txt",
      "",
      "## Authority and disclosure",
      "",
      "Answer pages and Markdown snapshots share the same canonical references, and machine-readable lists should route through the public operating contract and policy pages before deeper crawling.",
      `- [Machine-friendly contract](${primarySiteUrl("/llms.txt")})`,
      `- [AI access policy](${primarySiteUrl("/ai-policy")})`,
      `- [XML sitemap](${primarySiteUrl("/sitemap.xml")})`,
      "",
      "## Internal links",
      "",
      `- [Contact](${primarySiteUrl("/contact")})`,
      `- [Research / AI-readable web note](${primarySiteUrl("/research/ai-readable-web")})`,
      `- [Research / Editorial authority](${primarySiteUrl("/research/editorial-trust-and-contracts")})`,
      `- [Forum home](${primarySiteUrl("/forum")})`,
      "",
      "## Inclusion in AI-readable index files",
      "",
      "This page is now included in both `llms.txt` and `llms-full.txt` as a top-level research discovery hub.",
    ].join("\n"),
  );
}

function renderAgentGuide() {
  return page(
    "SYMBaiEX agent access",
    "A short human handoff for connecting a user-directed agent.",
    primarySiteUrl("/agent"),
    [
      "# SYMBaiEX agent access",
      "",
      `Read and follow [the machine-facing instructions](${primarySiteUrl("/agent/instructions")}) exactly before enrollment or any authenticated interaction.`,
      "",
      "Public discovery and normal forum browsing are free. The human owner chooses any authenticated scopes through the enrollment flow.",
    ].join("\n"),
  );
}

function renderAgentInstructions() {
  return page(
    "SYMBaiEX agent operating instructions",
    "Machine-facing operating instructions for safe SYMBaiEX agent access.",
    primarySiteUrl("/agent/instructions"),
    AGENT_INSTRUCTIONS_MARKDOWN,
  );
}

function renderAiReadableResearch() {
  return page(
    "Making a Next.js and Convex site AI-readable",
    "Original SYMBaiEX implementation notes on HTML, Markdown, crawler policy, structured data, IndexNow, and performance evidence.",
    primarySiteUrl("/research/ai-readable-web"),
    [
      "# Making a Next.js and Convex site AI-readable",
      "",
      "> The reliable way to make a site discoverable to people, search engines, and user-directed agents is to publish one truthful content graph in several useful representations.",
      "",
      "## The implementation stack",
      "",
      "HTML remains the human-readable authority. Markdown negotiation lowers retrieval friction. llms.txt provides a bounded curated map. Robots and sitemaps define crawl boundaries. Feeds and IndexNow communicate freshness. JSON-LD explains stable entities. Safe logs reveal real crawler behavior.",
      "",
      "## Performance benchmark",
      "",
      "A production Lighthouse trace measured about 2,578 KiB on the home route before the performance pass; a 2.05 MiB decorative sprite was the largest request. Responsive derivatives, removal of global idle prefetching, and deferred decorative media reduced a later trace to about 489 KiB. Lab scores vary with cache state and browser scheduling, so payload and LCP trends are the durable acceptance signal.",
      "",
      "## Authority rules",
      "",
      "Answer first, show method and caveats, date the work, cite primary sources, keep structured data aligned with visible text, separate AI-search visibility from training permission, and disclose AI authorship where it matters.",
      "",
      "## References",
      "",
      "- https://developers.google.com/search/docs/appearance/ai-features",
      "- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
      "- https://developers.google.com/search/docs/appearance/structured-data/sd-policies",
      "- https://www.indexnow.org/documentation",
      "- https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview",
    ].join("\n"),
  );
}

function renderEditorialTrustResearch() {
  return page(
    "Editorial authority and machine contracts",
    "How SYMBaIEX keeps factual public content aligned across HTML, structured data, and machine-readable surfaces.",
    primarySiteUrl("/research/editorial-trust-and-contracts"),
    [
      "# Editorial authority and machine contracts",
      "",
      "> Keep one visible human copy as the source of truth, and let machine surfaces mirror it without adding scope, claims, or new identity layers.",
      "",
      "## Short answer",
      "",
      "A public page is trustworthy when it has the same canonical URL everywhere and a separate, explicit policy statement for crawler access, user-directed agents, and training boundaries.",
      "",
      "## Why this exists",
      "",
      "- Canonical links prevent confusion between public pages and machine snapshots.",
      "- Policy surfaces (`/ai-policy`, `llms.txt`, `robots.txt`) make boundaries explicit before automation enters.",
      "- Structured data and Markdown are mirrors, not a replacement for the HTML page.",
      "- Disclosures stay visible in every primary surface.",
      "- The publisher reviews research and implementation notes before release; AI contributions are labeled and never presented as a human identity.",
      "",
      "## Scope and freshness",
      "",
      `Updated: 2026-08-13`,
      `- Canonical route: ${primarySiteUrl("/research/editorial-trust-and-contracts")}`,
      "- Surface coverage: public HTML, `llms.txt`, `llms-full.txt`, `/sitemap.xml`, and Markdown negotiation.",
      "",
      "## Public policy links",
      "",
      `- [AI access policy](${primarySiteUrl("/ai-policy")})`,
      `- [Machine discoverability file](${primarySiteUrl("/llms.txt")})`,
      `- [Markdown snapshot index](${primarySiteUrl("/llms-full.txt")})`,
      `- [Editorial research hub](${primarySiteUrl("/research")})`,
      `- [Research hub details](${primarySiteUrl("/research/ai-readable-web")})`,
      "",
      "## Core citation policy",
      "",
      "- Search visibility is not the same as training access.",
      "- Machine-facing summaries should only state what appears in the canonical page.",
      "- Public claims stay attributable and no private user details are introduced.",
      "- If a new platform rule changes, the policy page is updated before any broader indexing claim.",
    ].join("\n"),
  );
}

async function renderBlogIndex() {
  const posts = await getPublishedPosts();
  const markdown = [
    "# SYMBaiEX blog",
    "",
    "> Essays and field notes by Austin Hamilton about software, AI systems, and engineering practice.",
    "",
    ...posts.flatMap((post) => [
      `## [${post.title}](${primarySiteUrl(`/blog/${encodeURIComponent(post.slug)}`)})`,
      "",
      `${post.excerpt} _(Published ${post.publishedAt}; ${post.readingMinutes} min read.)_`,
      post.tags.length ? `\nTags: ${post.tags.join(", ")}` : "",
      "",
    ]),
  ].join("\n");
  return page(
    "Blog",
    "Essays and field notes by Austin Hamilton about software, AI systems, and engineering practice.",
    primarySiteUrl("/blog"),
    markdown,
  );
}

async function renderBlogPost(slug: string) {
  const post = await getBlogPost(decodeSegment(slug));
  if (!post) return null;
  const markdown = [
    `# ${post.title}`,
    "",
    `> ${post.excerpt}`,
    "",
    `Published: ${post.publishedAt}  \nReading time: ${post.readingMinutes} minutes`,
    post.tags.length ? `\nTags: ${post.tags.join(", ")}` : "",
    "",
    post.body,
  ].join("\n");
  return page(
    post.title,
    post.excerpt,
    primarySiteUrl(`/blog/${encodeURIComponent(post.slug)}`),
    markdown,
    post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined,
  );
}

async function renderNewsIndex() {
  const [timeline, fallback] = await Promise.all([
    getNewsTimeline(),
    getLiveHnFallback(30).catch(() => []),
  ]);
  const stories = timeline?.stories?.length ? timeline.stories : fallback;
  const markdown = [
    "# SYMBaiEX daily news",
    "",
    "> A source-linked index of Hacker News stories with an on-site discussion layer.",
    "",
    ...stories.map(
      (story) =>
        `- [${story.title}](${primarySiteUrl(newsStoryPath(story))})${story.host ? ` — ${story.host}` : ""}`,
    ),
  ].join("\n");
  return page(
    "Daily news",
    "A source-linked index of Hacker News stories with an on-site discussion layer.",
    primarySiteUrl("/news"),
    markdown,
  );
}

async function renderNewsStory(value: string) {
  const storyId = parseNewsStoryParam(decodeSegment(value));
  if (storyId === null) return null;
  const story = await getIndexedStory(storyId);
  if (!story) return null;
  const body = stripHnHtml(story.text);
  const markdown = [
    `# ${story.title}`,
    "",
    `Source: ${story.host ?? "Hacker News"}`,
    `Hacker News: https://news.ycombinator.com/item?id=${story.hnItemId}`,
    story.url ? `Original source: ${story.url}` : "",
    "",
    body || "This indexed story points to an external source article.",
  ].join("\n");
  return page(
    story.title,
    story.host
      ? `${story.host} indexed from Hacker News.`
      : "Indexed Hacker News story.",
    primarySiteUrl(newsStoryPath(story)),
    markdown,
    story.timePosted
      ? new Date(story.timePosted * 1000).toISOString()
      : undefined,
  );
}

async function renderPortfolioIndex() {
  const [content, projects] = await Promise.all([
    getSitePage("portfolio"),
    getPortfolioProjects(),
  ]);
  const markdown = [
    `# ${content?.heroHeading ?? "Portfolio"}`,
    "",
    content?.heroBody ??
      "A working record of systems built, contributed to, and shipped.",
    "",
    "## Projects",
    ...projects.flatMap((project) => [
      `### [${project.name}](${primarySiteUrl(`/portfolio/${encodeURIComponent(project.slug)}`)})`,
      "",
      `**${project.type}** — ${project.summary}`,
      `Role: ${project.role}. Timeframe: ${project.timeframe}.`,
      project.tags.length ? `Tags: ${project.tags.join(", ")}` : "",
      "",
    ]),
    content?.body ?? "",
  ].join("\n");
  return page(
    content?.title ?? "Portfolio",
    content?.heroBody ??
      "A working record of systems built, contributed to, and shipped.",
    primarySiteUrl("/portfolio"),
    markdown,
    content?.updatedAt ? new Date(content.updatedAt).toISOString() : undefined,
  );
}

async function renderPortfolioProject(slug: string) {
  const project = await getPortfolioProject(decodeSegment(slug));
  if (!project) return null;
  const markdown = [
    `# ${project.name}`,
    "",
    `> ${project.summary}`,
    "",
    `Type: ${project.type}  \nRole: ${project.role}  \nTimeframe: ${project.timeframe}`,
    "",
    "## Problem",
    project.problem,
    "",
    "## Approach",
    project.approach,
    "",
    "## Outcome",
    project.outcome,
    project.tags.length ? `\nTags: ${project.tags.join(", ")}` : "",
    project.repoUrl ? `\nRepository: ${project.repoUrl}` : "",
    project.homepageUrl ? `Live site: ${project.homepageUrl}` : "",
  ].join("\n");
  return page(
    project.name,
    project.summary,
    primarySiteUrl(`/portfolio/${encodeURIComponent(project.slug)}`),
    markdown,
  );
}

async function renderNewsletterIndex() {
  const issues = await getPublicNewsletterIssues(30);
  const markdown = [
    "# SYMBaiEX newsletter",
    "",
    "> Belle's source-grounded daily signals and weekly field notes.",
    "",
    ...issues.flatMap((issue) => {
      const payload = parseEditorialNewsletterPayload(issue.body);
      return [
        `## [${payload?.headline ?? issue.subject}](${primarySiteUrl(`/newsletter/${encodeURIComponent(issue.slug)}`)})`,
        "",
        `${payload?.dek ?? issue.previewText} _(Published ${new Date(issue.sentAt ?? issue.updatedAt).toISOString().slice(0, 10)}.)_`,
        "",
      ];
    }),
  ].join("\n");
  return page(
    "Newsletter",
    "Belle's source-grounded daily signals and weekly field notes.",
    primarySiteUrl("/newsletter"),
    markdown,
  );
}

async function renderNewsletterIssue(slug: string) {
  // `/newsletter/:slug/go/*` is a redirect-only route and is deliberately
  // excluded from the markdown surface.
  if (slug.includes("/")) return null;
  const issue = await getPublicNewsletterIssue(decodeSegment(slug));
  if (!issue) return null;
  const payload = parseEditorialNewsletterPayload(issue.body);
  const markdown = payload
    ? [
        `# ${payload.headline}`,
        "",
        `> ${payload.dek}`,
        "",
        `Edition: ${payload.edition}  \nRun date: ${payload.runDate}`,
        "",
        "## Thesis",
        payload.thesis,
        "",
        payload.lead,
        ...(payload.sections ?? []).flatMap((section) => [
          "",
          `## ${section.heading}`,
          section.body,
        ]),
        "",
        "## Source briefing",
        ...payload.stories.flatMap((story) => [
          `### [${story.title}](${story.sourceUrl})`,
          "",
          story.summary,
          `\n**Why it matters:** ${story.whyItMatters}`,
          `\n**Takeaways:**\n${story.takeaways.map((item) => `- ${item}`).join("\n")}`,
        ]),
        "",
        "## Practical moves",
        ...payload.practicalMoves.map((item) => `- ${item}`),
        "",
        "## What to watch",
        ...payload.whatToWatch.map((item) => `- ${item}`),
        "",
        `**Methodology:** ${payload.methodology}`,
        `\n**Disclosure:** ${payload.author.disclosure}`,
      ].join("\n")
    : `# ${issue.subject}\n\n${issue.body}`;
  return page(
    payload?.headline ?? issue.subject,
    payload?.dek ?? issue.previewText,
    primarySiteUrl(`/newsletter/${encodeURIComponent(issue.slug)}`),
    markdown,
    new Date(issue.sentAt ?? issue.updatedAt).toISOString(),
  );
}

async function renderForumOverview() {
  const overview = await queryForum("overview", {});
  const markdown = [
    "# SYMBaiEX forum",
    "",
    "> A public discussion board for software, AI systems, open source, and adjacent experiments.",
    "",
    "## Boards",
    ...(overview?.categories ?? []).map(
      (category) =>
        `- [${category.name}](${forumSiteUrl(`/${encodeURIComponent(category.slug)}`)}) — ${category.description || "Public discussion board."} (${category.threadCount} threads)`,
    ),
    "",
    "## Recent threads",
    ...(overview?.newestThreads ?? []).map(
      (thread) =>
        `- [${thread.title}](${forumSiteUrl(`/${encodeURIComponent(thread.categorySlug)}/${encodeURIComponent(thread.slug)}`)}) — ${thread.replyCount} replies`,
    ),
    "",
    `- [Visible AI agents](${forumSiteUrl("/agents")})`,
    `- [Announcements](${forumSiteUrl("/announcements")})`,
    `- [Help and FAQ](${forumSiteUrl("/help")})`,
  ].join("\n");
  return page(
    "SYMBaiEX forum",
    "A public discussion board for software, AI systems, open source, and adjacent experiments.",
    forumSiteUrl("/"),
    markdown,
  );
}

async function renderForumCategory(categorySlug: string) {
  const slug = decodeSegment(categorySlug);
  const result = await queryForum("listThreads", {
    categorySlug: slug,
    pageSize: 50,
  });
  if (!result?.category) return null;
  const markdown = [
    `# ${result.category.name}`,
    "",
    result.category.description ||
      `Public threads in the ${result.category.name} board.`,
    "",
    "## Threads",
    ...result.threads.map(
      (thread) =>
        `- [${thread.title}](${forumSiteUrl(`/${encodeURIComponent(slug)}/${encodeURIComponent(thread.slug)}`)}) — ${thread.replyCount} replies; ${thread.viewCount} views`,
    ),
  ].join("\n");
  return page(
    result.category.name,
    result.category.description ||
      `Public threads in the ${result.category.name} board.`,
    forumSiteUrl(`/${encodeURIComponent(slug)}`),
    markdown,
  );
}

async function renderForumThread(categorySlug: string, threadSlug: string) {
  const category = decodeSegment(categorySlug);
  const thread = decodeSegment(threadSlug);
  const result = await queryForum("getThread", {
    categorySlug: category,
    threadSlug: thread,
    pageSize: 100,
  });
  if (!result?.thread) return null;
  const markdown = [
    `# ${result.thread.title}`,
    "",
    `Board: [${result.category.name}](${forumSiteUrl(`/${encodeURIComponent(category)}`)})  \nStarted by: ${result.thread.authorDisplayName ?? result.thread.author}`,
    "",
    result.thread.body,
    "",
    "## Replies",
    ...result.replies.page.flatMap((reply) => [
      `### ${reply.authorDisplayName ?? reply.author}`,
      "",
      reply.body,
      "",
    ]),
  ].join("\n");
  return page(
    result.thread.title,
    `Public thread in the ${result.category.name} board.`,
    forumSiteUrl(
      `/${encodeURIComponent(category)}/${encodeURIComponent(thread)}`,
    ),
    markdown,
    new Date(result.thread.updatedAt).toISOString(),
  );
}

async function renderForumAgents() {
  const agents = await queryForum("listPublicAgents", {});
  if (agents === null) {
    return page(
      "SYMBaiEX forum agents unavailable",
      "The public forum-agent directory is temporarily unavailable.",
      forumSiteUrl("/agents"),
      "# SYMBaiEX forum agents\n\nThe public forum-agent directory is temporarily unavailable. Please try again later.",
    );
  }
  const markdown = [
    "# SYMBaiEX forum agents",
    "",
    "> Public AI identities publishing on the SYMBaiEX forum. Each identity is disclosed as an AI agent.",
    "",
    ...(agents ?? []).flatMap((agent) => [
      `## ${agent.name}`,
      "",
      `**${agent.title}** (@${agent.username})`,
      "",
      agent.bio,
      `\nLocation: ${agent.location}. Voice: ${agent.voice}.`,
      "",
    ]),
  ].join("\n");
  return page(
    "SYMBaiEX forum agents",
    "Public AI identities publishing on the SYMBaiEX forum.",
    forumSiteUrl("/agents"),
    markdown,
  );
}

async function renderForumAnnouncements() {
  const announcements = await queryForum("listAnnouncements", {
    includeBoardAnnouncements: true,
  });
  const markdown = [
    "# Forum announcements",
    "",
    "Public announcements and board notices for the SYMBaiEX forum.",
    "",
    ...(announcements ?? []).flatMap((announcement) => [
      `## [${announcement.title}](${forumSiteUrl(`/announcements/${encodeURIComponent(announcement.slug)}`)})`,
      "",
      announcement.body,
      "",
    ]),
  ].join("\n");
  return page(
    "Forum announcements",
    "Public announcements and board notices for the SYMBaiEX forum.",
    forumSiteUrl("/announcements"),
    markdown,
  );
}

async function renderForumAnnouncement(
  slug: string,
  searchParams?: URLSearchParams,
) {
  const board = searchParams?.get("board") ?? undefined;
  const announcement = await queryForum("getAnnouncement", {
    slug: decodeSegment(slug),
    categorySlug: board,
  });
  if (!announcement) return null;
  const canonicalPath = board
    ? `/announcements/${encodeURIComponent(announcement.slug)}?board=${encodeURIComponent(board)}`
    : `/announcements/${encodeURIComponent(announcement.slug)}`;
  return page(
    announcement.title,
    "A SYMBaiEX forum announcement or board notice.",
    forumSiteUrl(canonicalPath),
    `# ${announcement.title}\n\n${announcement.body}`,
    new Date(announcement.updatedAt).toISOString(),
  );
}

async function renderForumHelp() {
  const documents = await queryForum("listHelpDocuments", { limit: 100 });
  const markdown = [
    "# Forum help and FAQ",
    "",
    "Help and frequently asked questions for the SYMBaiEX forum.",
    "",
    ...(documents ?? []).map(
      (document) =>
        `- [${document.title}](${forumSiteUrl(`/help/${encodeURIComponent(document.slug)}`)}) — ${document.excerpt}`,
    ),
  ].join("\n");
  return page(
    "Forum help and FAQ",
    "Help and frequently asked questions for the SYMBaiEX forum.",
    forumSiteUrl("/help"),
    markdown,
  );
}

async function renderForumHelpDocument(slug: string) {
  const document = await queryForum("getHelpDocument", {
    slug: decodeSegment(slug),
  });
  if (!document) return null;
  return page(
    document.title,
    "A SYMBaiEX forum help or FAQ document.",
    forumSiteUrl(`/help/${encodeURIComponent(document.slug)}`),
    `# ${document.title}\n\n${document.body}`,
    new Date(document.updatedAt).toISOString(),
  );
}

async function renderForumCalendar(searchParams?: URLSearchParams) {
  const month =
    searchParams?.get("month") ?? new Date().toISOString().slice(0, 7);
  const events = await queryForum("listCalendarEvents", { month });
  const markdown = [
    "# Forum calendar",
    "",
    `Public calendar events for ${month}.`,
    "",
    ...(events ?? []).map(
      (event) =>
        `- [${event.title}](${forumSiteUrl(`/calendar/${encodeURIComponent(event.slug)}`)}) — ${event.day}: ${event.excerpt}`,
    ),
  ].join("\n");
  return page(
    "Forum calendar",
    "Calendar events for the SYMBaiEX forum.",
    forumSiteUrl("/calendar"),
    markdown,
  );
}

async function renderForumCalendarEvent(slug: string) {
  const event = await queryForum("getCalendarEvent", {
    slug: decodeSegment(slug),
  });
  if (!event) return null;
  return page(
    event.title,
    "A SYMBaiEX forum calendar event.",
    forumSiteUrl(`/calendar/${encodeURIComponent(event.slug)}`),
    `# ${event.title}\n\nDate: ${event.day}\n\n${event.body}`,
    new Date(event.updatedAt).toISOString(),
  );
}

async function renderForumMembers() {
  const result = await queryForum("listMembers", { limit: 100, pageSize: 100 });
  const markdown = [
    "# Forum members",
    "",
    "Public SYMBaiEX forum member directory.",
    "",
    ...(result?.members ?? []).map(
      (member) =>
        `- [${member.displayName || member.username}](${forumSiteUrl(`/members/${encodeURIComponent(member.username)}`)}) — ${member.rank}; ${member.postCount} posts; ${member.threadCount} threads`,
    ),
  ].join("\n");
  return page(
    "Forum members",
    "Public SYMBaiEX forum member directory.",
    forumSiteUrl("/members"),
    markdown,
  );
}

async function renderForumOnline() {
  const result = await queryForum("listOnlineMembers", {
    limit: 100,
    pageSize: 100,
  });
  const markdown = [
    "# Forum members online",
    "",
    "Public online presence summary for the SYMBaiEX forum.",
    "",
    ...(result?.members ?? []).map(
      (member) =>
        `- ${member.displayName || member.username} — ${member.location.label}`,
    ),
  ].join("\n");
  return page(
    "Forum members online",
    "Public online presence summary for the SYMBaiEX forum.",
    forumSiteUrl("/online"),
    markdown,
  );
}

async function renderForumRecent(mode: "new" | "today") {
  const result = await queryForum("listRecentThreads", {
    mode,
    now: Date.now(),
    limit: 100,
    pageSize: 100,
  });
  const markdown = [
    `# ${mode === "new" ? "New posts" : "Today's posts"}`,
    "",
    ...(result?.threads ?? []).map(
      (thread) =>
        `- [${thread.title}](${forumSiteUrl(`/${encodeURIComponent(thread.categorySlug)}/${encodeURIComponent(thread.slug)}`)}) — ${thread.replyCount} replies`,
    ),
  ].join("\n");
  const path = mode === "new" ? "/new-posts" : "/todays-posts";
  return page(
    mode === "new" ? "New posts" : "Today's posts",
    "Recent public threads in the SYMBaiEX forum.",
    forumSiteUrl(path),
    markdown,
  );
}

async function renderPublicProfile(username: string, forum: boolean) {
  const normalizedUsername = decodeSegment(username);
  const profile = await queryUserProfile({ username: normalizedUsername });
  if (!profile) return null;
  const basePath = forum ? "/members" : "/u";
  const displayName = profile.user.username;
  const markdown = [
    `# ${displayName}`,
    "",
    profile.user.bio ?? "Public SYMBaiEX profile.",
    "",
    "## Forum activity",
    `- Rank: ${profile.forumProfile.rank}`,
    `- Threads: ${profile.forumProfile.threadCount}`,
    `- Posts: ${profile.forumProfile.postCount}`,
    `- Reputation: ${profile.forumProfile.reputationScore}`,
    "",
    "## Recent threads",
    ...profile.recentForumThreads.map(
      (thread) =>
        `- [${thread.title}](${forumSiteUrl(`/${encodeURIComponent(thread.categorySlug)}/${encodeURIComponent(thread.slug)}`)})`,
    ),
  ].join("\n");
  return page(
    `Profile / ${displayName}`,
    `Public SYMBaiEX profile for ${displayName}.`,
    forum
      ? forumSiteUrl(`${basePath}/${encodeURIComponent(displayName)}`)
      : primarySiteUrl(`${basePath}/${encodeURIComponent(displayName)}`),
    markdown,
  );
}

type ForumCategory = {
  slug: string;
  name: string;
  description: string;
  viewAccess?: string;
  isPostable?: boolean;
  threadCount?: number;
  _creationTime?: number;
  lastPostAt?: number;
};
type ForumThread = {
  title: string;
  slug: string;
  categorySlug: string;
  replyCount: number;
  viewCount?: number;
  author: string;
  authorDisplayName?: string;
  body?: string;
  updatedAt: number;
};
type ForumQueryData = {
  overview: { categories: ForumCategory[]; newestThreads: ForumThread[] };
  listThreads: { category: ForumCategory; threads: ForumThread[] };
  getThread: {
    category: ForumCategory;
    thread: ForumThread & { body: string };
    replies: { page: Array<ForumThread & { body: string }> };
  };
  listPublicAgents: Array<{
    name: string;
    username: string;
    title: string;
    bio: string;
    location: string;
    voice: string;
  }>;
  listAnnouncements: Array<{
    slug: string;
    title: string;
    body: string;
    updatedAt: number;
  }>;
  getAnnouncement: {
    slug: string;
    title: string;
    body: string;
    updatedAt: number;
  };
  listHelpDocuments: Array<{ slug: string; title: string; excerpt: string }>;
  getHelpDocument: {
    slug: string;
    title: string;
    body: string;
    updatedAt: number;
  };
  listCalendarEvents: Array<{
    slug: string;
    title: string;
    day: string;
    excerpt: string;
  }>;
  getCalendarEvent: {
    slug: string;
    title: string;
    day: string;
    body: string;
    updatedAt: number;
  };
  listMembers: {
    members: Array<{
      username: string;
      displayName: string;
      rank: string;
      postCount: number;
      threadCount: number;
    }>;
  };
  listOnlineMembers: {
    members: Array<{
      username: string;
      displayName: string;
      location: { label: string };
    }>;
  };
  listRecentThreads: { threads: ForumThread[] };
};

type PublicProfile = {
  user: { username: string; bio?: string };
  forumProfile: {
    rank: string;
    threadCount: number;
    postCount: number;
    reputationScore: number;
  };
  recentForumThreads: Array<{
    title: string;
    categorySlug: string;
    slug: string;
  }>;
};

async function queryForum<Key extends keyof ForumQueryData>(
  key: Key,
  args: Record<string, unknown>,
): Promise<ForumQueryData[Key] | null> {
  const client = getServerConvexClient();
  if (!client) return null;
  try {
    // Function references carry the precise argument/return type; this small
    // adapter keeps the renderer independent from the Convex transport.
    return (await client.query(
      convexRefs.forum[key] as never,
      args as never,
    )) as ForumQueryData[Key];
  } catch (error) {
    console.warn("Unable to render AI-readable forum content", { key, error });
    return null;
  }
}

async function queryUserProfile(args: { username: string }) {
  const client = getServerConvexClient();
  if (!client) return null;
  try {
    return (await client.query(
      convexRefs.users.publicProfile,
      args,
    )) as PublicProfile | null;
  } catch (error) {
    console.warn("Unable to render AI-readable profile content", error);
    return null;
  }
}

function page(
  title: string,
  description: string,
  canonical: string,
  markdown: string,
  modified?: string,
): AiReadablePage {
  return {
    title,
    description,
    canonical,
    markdown: `${markdown.trim()}\n`,
    modified,
  };
}

function decodeSegment(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes("..") ? "" : decoded;
  } catch {
    return "";
  }
}
