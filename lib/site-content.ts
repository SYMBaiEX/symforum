import { convexRefs } from "@/lib/convex-refs";
import {
  defaultPortfolioProjects,
  fallbackSitePage,
  type PortfolioProjectRecord,
  type SitePageRecord,
} from "@/lib/site-content-defaults";
import { readThroughServerCache } from "@/lib/server-cache";
import { getServerConvexClient } from "@/lib/server-convex";
import { cache } from "react";

const SITE_CONTENT_TTL_MS = 30 * 1000;
const RETIRED_PORTFOLIO_SLUGS = new Set(["gitshipt", "arklib", "pod-protocol"]);
const REFRESHED_PORTFOLIO_SLUGS = new Set(["usagemax", "symclick"]);
const REFRESHED_PORTFOLIO_PROJECTS = new Map(
  defaultPortfolioProjects
    .filter((project) => REFRESHED_PORTFOLIO_SLUGS.has(project.slug))
    .map((project) => [project.slug, project] as const),
);

export const getSitePage = cache(async function getSitePage(
  slug: string,
): Promise<SitePageRecord | null> {
  const convex = getServerConvexClient();
  if (convex === null) {
    return fallbackSitePage(slug);
  }

  try {
    const page = await readThroughServerCache(
      `site-page:${slug}`,
      SITE_CONTENT_TTL_MS,
      () => convex.query(convexRefs.siteContent.getPage, { slug }),
    );
    return page ?? fallbackSitePage(slug);
  } catch (error) {
    console.warn("Falling back to static site page", error);
    return fallbackSitePage(slug);
  }
});

export const getPortfolioProjects = cache(
  async function getPortfolioProjects(): Promise<PortfolioProjectRecord[]> {
    const convex = getServerConvexClient();
    if (convex === null) {
      return defaultPortfolioProjects;
    }

    try {
      const projects = await readThroughServerCache(
        "portfolio-projects",
        SITE_CONTENT_TTL_MS,
        () => convex.query(convexRefs.siteContent.listPortfolioProjects, {}),
      );
      return curatedPortfolioProjects(
        projects.length > 0 ? projects : defaultPortfolioProjects,
      );
    } catch (error) {
      console.warn("Falling back to static portfolio projects", error);
      return defaultPortfolioProjects;
    }
  },
);

export const getPortfolioProject = cache(async function getPortfolioProject(
  slug: string,
): Promise<PortfolioProjectRecord | null> {
  const projects = await getPortfolioProjects();
  return projects.find((project) => project.slug === slug) ?? null;
});

function curatedPortfolioProjects(projects: PortfolioProjectRecord[]) {
  const retainedProjects = projects.filter(
    (project) =>
      !RETIRED_PORTFOLIO_SLUGS.has(project.slug) &&
      !REFRESHED_PORTFOLIO_PROJECTS.has(project.slug),
  );

  return [...retainedProjects, ...REFRESHED_PORTFOLIO_PROJECTS.values()].sort(
    (left, right) => left.order - right.order,
  );
}
