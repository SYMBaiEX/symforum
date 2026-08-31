import { describe, expect, test, vi } from "vitest";

const metrics = vi.hoisted(() => vi.fn());

vi.mock("@/lib/portfolio-metrics", () => ({
  getCachedGithubPortfolioMetrics: metrics,
}));

import { GET } from "./route";

describe("GitHub metrics endpoint", () => {
  test("returns cached portfolio metrics with the declared CDN policy", async () => {
    metrics.mockResolvedValue({ repositories: 12, stars: 34 });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      metrics: { repositories: 12, stars: 34 },
    });
  });
});
