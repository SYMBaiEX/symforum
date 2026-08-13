import { getPublishedPosts } from "@/lib/blog-data";
import { getDailyNews, getNewsTimeline } from "@/lib/news-data";
import { newsStoryPath } from "@/lib/news-slugs";
import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import { forumSiteUrl, primarySiteUrl } from "@/lib/site-urls";
import { getPortfolioProjects } from "@/lib/site-content";
import { convexRefs } from "@/lib/convex-refs";
import { getServerConvexClient } from "@/lib/server-convex";
import type { MetadataRoute } from "next";

const PRIMARY_PATHS = [
  "/",
  "/about",
  "/ai-policy",
  "/agent",
  "/blog",
  "/contact",
  "/news",
  "/newsletter",
  "/portfolio",
];

const FORUM_PATHS = [
  "/",
  "/agents",
  "/announcements",
  "/calendar",
  "/help",
  "/members",
  "/new-posts",
  "/online",
  "/todays-posts",
];

export const revalidate = 3600;
// Google’s sitemap protocol permits up to 50,000 URLs per sitemap file.
const MAX_SITEMAP_ENTRIES = 50_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [postsResult, projectsResult, issuesResult, newsResult] =
    await Promise.allSettled([
      getPublishedPosts(),
      getPortfolioProjects(),
      getPublicNewsletterIssues(30),
      getPublicNewsStories(),
    ]);

  logSitemapSourceFailure("blog", postsResult);
  logSitemapSourceFailure("portfolio", projectsResult);
  logSitemapSourceFailure("newsletter", issuesResult);
  logSitemapSourceFailure("news", newsResult);

  const entries: MetadataRoute.Sitemap = [
    ...PRIMARY_PATHS.map(primaryEntry),
    ...FORUM_PATHS.map(forumEntry),
  ];

  if (postsResult.status === "fulfilled") {
    entries.push(
      ...postsResult.value.map((post) => ({
        url: primarySiteUrl(`/blog/${encodeURIComponent(post.slug)}`),
        lastModified: validDate(post.publishedAt),
        changeFrequency: "monthly" as const,
        priority: post.featured ? 0.8 : 0.6,
      })),
    );
  }

  if (projectsResult.status === "fulfilled") {
    entries.push(
      ...projectsResult.value.map((project) => ({
        url: primarySiteUrl(`/portfolio/${encodeURIComponent(project.slug)}`),
        changeFrequency: "monthly" as const,
        priority: 0.6,
      })),
    );
  }

  if (issuesResult.status === "fulfilled") {
    entries.push(
      ...issuesResult.value.map((issue) => ({
        url: primarySiteUrl(`/newsletter/${encodeURIComponent(issue.slug)}`),
        lastModified: validDate(issue.sentAt ?? issue.updatedAt),
        changeFrequency: "weekly" as const,
        priority: 0.7,
      })),
    );
  }

  if (newsResult.status === "fulfilled") {
    entries.push(
      ...newsResult.value.map((story) => ({
        url: primarySiteUrl(newsStoryPath(story)),
        lastModified: story.timePosted
          ? validDate(story.timePosted * 1000)
          : undefined,
        changeFrequency: "daily" as const,
        priority: 0.5,
      })),
    );
  }

  const forumResult = await getPublicForumSitemapEntries();
  entries.push(...forumResult);

  const bounded = dedupeEntries(entries);
  if (bounded.length > MAX_SITEMAP_ENTRIES) {
    console.warn(
      `Sitemap entry cap reached: ${bounded.length} > ${MAX_SITEMAP_ENTRIES}`,
    );
  }
  return bounded.slice(0, MAX_SITEMAP_ENTRIES);
}

async function getPublicForumSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const convex = getServerConvexClient();
  if (!convex) return [];

  try {
    const [categories, announcements, helpDocuments, calendarEvents] =
      await Promise.all([
        convex.query(convexRefs.forum.listCategories, { limit: 100 }),
        convex.query(convexRefs.forum.listAnnouncements, {
          includeBoardAnnouncements: true,
        }),
        convex.query(convexRefs.forum.listHelpDocuments, { limit: 100 }),
        convex.query(convexRefs.forum.listCalendarEvents, {
          month: new Date().toISOString().slice(0, 7),
        }),
      ]);
    const threadResults = await Promise.all(
      categories
        .filter(
          (category) => category.isPostable && category.viewAccess === "public",
        )
        .map((category) =>
          convex
            .query(convexRefs.forum.listThreads, {
              categorySlug: category.slug,
              limit: 100,
              pageSize: 100,
            })
            .catch(() => null),
        ),
    );
    const entries: MetadataRoute.Sitemap = [
      ...categories
        .filter((category) => category.viewAccess === "public")
        .map((category) => ({
          url: forumSiteUrl(`/${encodeURIComponent(category.slug)}`),
          lastModified: validDate(
            category.lastPostAt ?? category._creationTime,
          ),
          changeFrequency: "daily" as const,
          priority: 0.6,
        })),
      ...threadResults.flatMap(
        (result) =>
          result?.threads.map((thread) => ({
            url: forumSiteUrl(
              `/${encodeURIComponent(thread.categorySlug)}/${encodeURIComponent(thread.slug)}`,
            ),
            lastModified: validDate(thread.updatedAt),
            changeFrequency: "daily" as const,
            priority: 0.5,
          })) ?? [],
      ),
      ...announcements.map((announcement) => ({
        url: forumSiteUrl(
          `/announcements/${encodeURIComponent(announcement.slug)}`,
        ),
        lastModified: validDate(announcement.updatedAt),
        changeFrequency: "weekly" as const,
        priority: 0.4,
      })),
      ...helpDocuments.map((document) => ({
        url: forumSiteUrl(`/help/${encodeURIComponent(document.slug)}`),
        lastModified: validDate(document.updatedAt),
        changeFrequency: "monthly" as const,
        priority: 0.4,
      })),
      ...calendarEvents.map((event) => ({
        url: forumSiteUrl(`/calendar/${encodeURIComponent(event.slug)}`),
        lastModified: validDate(event.updatedAt),
        changeFrequency: "monthly" as const,
        priority: 0.3,
      })),
    ];
    return entries;
  } catch (error) {
    console.warn("Unable to add public forum routes to sitemap", error);
    return [];
  }
}

function primaryEntry(path: string): MetadataRoute.Sitemap[number] {
  return {
    url: primarySiteUrl(path),
    changeFrequency: path === "/" ? "daily" : "weekly",
    priority: path === "/" ? 1 : 0.7,
  };
}

function forumEntry(path: string): MetadataRoute.Sitemap[number] {
  return {
    url: forumSiteUrl(path),
    changeFrequency: path === "/" ? "hourly" : "daily",
    priority: path === "/" ? 0.9 : 0.6,
  };
}

async function getPublicNewsStories() {
  const timeline = await getNewsTimeline();
  if (timeline?.stories?.length) {
    return timeline.stories;
  }
  return await getDailyNews(30);
}

function validDate(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function dedupeEntries(entries: MetadataRoute.Sitemap) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) {
      return false;
    }
    seen.add(entry.url);
    return true;
  });
}

function logSitemapSourceFailure<T>(
  source: string,
  result: PromiseSettledResult<T>,
) {
  if (result.status !== "rejected") return;
  const rawMessage =
    result.reason instanceof Error
      ? result.reason.message
      : "unknown sitemap source failure";
  const message = rawMessage
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 240);
  console.error("Sitemap source unavailable", { source, message });
}
