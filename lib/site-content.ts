import { convexRefs } from "@/lib/convex-refs";
import {
  defaultPortfolioProjects,
  fallbackSitePage,
  type PortfolioProjectRecord,
  type SitePageRecord,
} from "@/lib/site-content-defaults";
import { ConvexHttpClient } from "convex/browser";

function client() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  return url ? new ConvexHttpClient(url) : null;
}

export async function getSitePage(
  slug: string,
): Promise<SitePageRecord | null> {
  const convex = client();
  if (convex === null) {
    return fallbackSitePage(slug);
  }

  try {
    const page = await convex.query(convexRefs.siteContent.getPage, { slug });
    return page ?? fallbackSitePage(slug);
  } catch (error) {
    console.warn("Falling back to static site page", error);
    return fallbackSitePage(slug);
  }
}

export async function getPortfolioProjects(): Promise<
  PortfolioProjectRecord[]
> {
  const convex = client();
  if (convex === null) {
    return defaultPortfolioProjects;
  }

  try {
    const projects = await convex.query(
      convexRefs.siteContent.listPortfolioProjects,
      {},
    );
    return projects.length > 0 ? projects : defaultPortfolioProjects;
  } catch (error) {
    console.warn("Falling back to static portfolio projects", error);
    return defaultPortfolioProjects;
  }
}
