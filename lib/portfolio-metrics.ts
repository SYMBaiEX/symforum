import { convexRefs } from "@/lib/convex-refs";
import {
  fallbackGithubPortfolioMetrics,
  type GithubPortfolioMetrics,
} from "@/lib/github-portfolio";
import { readThroughServerCache } from "@/lib/server-cache";
import { getServerConvexClient } from "@/lib/server-convex";
import { cache } from "react";

const PORTFOLIO_METRICS_TTL_MS = 5 * 60 * 1000;

export const getCachedGithubPortfolioMetrics = cache(
  async function getCachedGithubPortfolioMetrics(): Promise<GithubPortfolioMetrics> {
    const convex = getServerConvexClient();
    if (convex === null) {
      return fallbackGithubPortfolioMetrics;
    }

    try {
      const snapshot = await readThroughServerCache(
        "github-portfolio-snapshot",
        PORTFOLIO_METRICS_TTL_MS,
        () => convex.query(convexRefs.githubPortfolio.latest, {}),
      );
      if (!snapshot?.metricsJson) {
        return fallbackGithubPortfolioMetrics;
      }
      return JSON.parse(snapshot.metricsJson) as GithubPortfolioMetrics;
    } catch (error) {
      console.warn("Falling back to static GitHub portfolio metrics", error);
      return fallbackGithubPortfolioMetrics;
    }
  },
);
