import { describe, expect, test } from "vitest";

import nextConfig from "./next.config";

describe("Platform content subdomain redirects", () => {
  test("redirects content paths only from the primary www host", async () => {
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

    expect(contentRules).toHaveLength(6);
    for (const rule of contentRules ?? []) {
      expect(rule.has).toEqual([{ type: "host", value: "www.symbaiex.com" }]);
    }
  });
});
