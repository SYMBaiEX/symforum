import { describe, expect, test } from "vitest";

import { shouldPrefetchPrimaryRoutes } from "./route-image-preloader";

describe("route image preloader", () => {
  test("does not prefetch primary-site RSC routes from the forum subdomain", () => {
    expect(shouldPrefetchPrimaryRoutes("forum.symbaiex.com")).toBe(false);
    expect(shouldPrefetchPrimaryRoutes("forum.localhost")).toBe(false);
  });

  test("keeps primary route warming on the primary site", () => {
    expect(shouldPrefetchPrimaryRoutes("www.symbaiex.com")).toBe(true);
    expect(shouldPrefetchPrimaryRoutes("localhost")).toBe(true);
  });
});
