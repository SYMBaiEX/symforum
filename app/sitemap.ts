import { getPublishedPosts } from "@/lib/blog-data";
import { getDailyNews, getNewsTimeline } from "@/lib/news-data";
import { newsStoryPath } from "@/lib/news-slugs";
import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import { forumSiteUrl, primarySiteUrl } from "@/lib/site-urls";
import { getPortfolioProjects } from "@/lib/site-content";
import type { MetadataRoute } from "next";

const PRIMARY_PATHS = [
  "/",
  "/about",
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [postsResult, projectsResult, issuesResult, newsResult] =
    await Promise.allSettled([
      getPublishedPosts(),
      getPortfolioProjects(),
      getPublicNewsletterIssues(30),
      getPublicNewsStories(),
    ]);

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

  return dedupeEntries(entries);
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
