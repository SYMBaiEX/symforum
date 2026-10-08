import { describe, expect, test } from "vitest";

import { contentSubdomainRootPath } from "./content-subdomain-routing";

describe("content subdomain routing", () => {
  test.each([
    ["blog.symbaiex.com", "/blog"],
    ["news.symbaiex.com", "/news"],
    ["newsletter.symbaiex.com", "/newsletter"],
  ])("routes the root of %s to %s", (host, pathname) => {
    expect(contentSubdomainRootPath({ host, pathname: "/" })).toBe(pathname);
  });

  test("leaves other hosts and explicit routes alone", () => {
    expect(
      contentSubdomainRootPath({ host: "www.symbaiex.com", pathname: "/" }),
    ).toBeNull();
    expect(
      contentSubdomainRootPath({
        host: "blog.symbaiex.com",
        pathname: "/blog",
      }),
    ).toBeNull();
    expect(
      contentSubdomainRootPath({
        host: "blog.example.com",
        pathname: "/",
      }),
    ).toBeNull();
  });
});
