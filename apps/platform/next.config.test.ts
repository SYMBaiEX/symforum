import { describe, expect, test } from "vitest";

import nextConfig from "./next.config";

describe("Platform content routes", () => {
  test("does not add cross-host redirects for the shared content routes", async () => {
    const redirects = await nextConfig.redirects?.();
    const contentPaths = [
      "/blog",
      "/blog/:path*",
      "/news",
      "/news/:path*",
      "/newsletter",
      "/newsletter/:path*",
    ];
    const contentRules = redirects?.filter((rule) =>
      contentPaths.includes(rule.source),
    );

    expect(contentRules).toHaveLength(0);
  });
});
